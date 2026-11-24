/**
 * Community Message File Upload API Route
 * Handles file uploads for messages (images, videos, documents, audio)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import formidable from 'formidable';
import fs from 'fs';
import { communityMember, decideCommunityMessageAccess, isStoredId } from '@/lib/account-access';
import { publicUploadFailure } from '@/lib/public-error';
import os from 'os';
import { CHAT_EXTS, inspectUpload } from '@/lib/upload-check';
import { isActiveContent } from '@/lib/upload-safety';
import { allowRequest, uploadLimiter } from '@/lib/content-rate-limit';
import { ATTACHMENT_MAX_BYTES, attachmentPath, attachmentsAvailable, storeChatAttachment } from '@/lib/chat-attachments';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadMessageFile(req: AuthRequest, res: NextApiResponse) {
  // Phase 15: rate limited; temporary storage only; access checked before anything is kept;
  // stored privately (lib/chat-attachments.ts), never under public/.
  if (!(await allowRequest(uploadLimiter, { userId: req.user!.userId, res, getDb }))) return undefined;
  if (!attachmentsAvailable()) return res.status(503).json({ error: 'File sharing is not available right now. You can still send text messages.' });
  let tempPath: string | null = null;
  try {
    const form = formidable({
      uploadDir: os.tmpdir(),
      keepExtensions: false,
      maxFiles: 1,
      maxFileSize: ATTACHMENT_MAX_BYTES,
    });

    const [fields, files] = await form.parse(req);

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const roomId = Array.isArray(fields.roomId) ? fields.roomId[0] : fields.roomId;
    const type = Array.isArray(fields.type) ? fields.type[0] : fields.type;
    if (file) tempPath = file.filepath;

    if (!file || !roomId || !type) {
      return res.status(400).json({ error: 'File, roomId, and type are required' });
    }

    // Pages, SVG and scripts would run from this site's origin; they are refused (lib/upload-safety.js).
    if (isActiveContent({ originalFilename: file.originalFilename, mimetype: file.mimetype })) {
      if (fs.existsSync(file.filepath)) fs.unlinkSync(file.filepath);
      return res.status(400).json({ error: 'This file type cannot be shared. Send an image, video, audio or document file.', code: 'file_type_not_allowed' });
    }


    // Save message to database
    const db = await getDb();
    const messages = db.collection('communityMessages');
    const rooms = db.collection('communityRooms');
    const users = db.collection('users');

    // Verify room access
    if (!isStoredId(roomId)) {
      return res.status(400).json({ error: 'Invalid room ID format' });
    }
    const room = await rooms.findOne({ _id: new ObjectId(roomId) });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1, studentDetails: 1, name: 1, profilePhoto: 1 } }
    );
    const access = decideCommunityMessageAccess({
      member: communityMember(req.user!.userId, user),
      room,
    });
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    // Look inside, then store privately under a random name; the message links to the authorized reader route.
    const checked = await inspectUpload(file.filepath, { name: file.originalFilename, allow: CHAT_EXTS });
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error, code: checked.code });
    const messageId = new ObjectId();
    const attachment = await storeChatAttachment(file.filepath, 'community-chat');
    const fileUrl = attachmentPath('community', messageId.toString());

    // Get sender info
    const message = {
      _id: messageId,
      attachment,
      roomId: access.roomId,
      senderId: access.senderId,
      type,
      content: checked.fileName,
      fileUrl,
      fileName: checked.fileName,
      fileSize: checked.bytes,
      reactions: [],
      seenBy: [access.senderId],
      delivered: true,
      createdAt: new Date(),
    };

    const result = await messages.insertOne(message);

    // Update room
    await rooms.updateOne(
      { _id: new ObjectId(roomId) },
      { $set: { updatedAt: new Date() } }
    );

    // Emit socket event to ALL users in the room (including sender) - like WhatsApp
    if (req.io) {
      const roomIdObj = new ObjectId(roomId);
      const messageToEmit = {
        ...message,
        _id: result.insertedId.toString(),
        senderId: access.senderId,
        senderName: user?.name || 'Unknown',
        senderPhoto: user?.profilePhoto || null,
        roomId: roomIdObj.toString(), // Ensure roomId is included for filtering
      };
      // Broadcast to ALL users in the room (including sender) - like WhatsApp
      // Use both string and ObjectId formats to ensure all users receive it
      const roomIdStr = roomIdObj.toString();
      req.io.to(`room:${roomIdStr}`).emit('message', messageToEmit);
      // Also emit to the original roomId format if different
      if (roomId !== roomIdStr) {
        req.io.to(`room:${roomId}`).emit('message', messageToEmit);
      }
    }

    res.json({
      success: true,
      message: {
        ...message,
        _id: result.insertedId.toString(),
        senderName: user?.name || 'Unknown',
        senderPhoto: user?.profilePhoto || null,
      },
    });
  } catch (error: any) {
    const failure = publicUploadFailure(error, { limitMessage: 'File size exceeds 25MB limit' });
    return res.status(failure.status).json(failure.body);
  } finally {
    if (tempPath) fs.promises.unlink(tempPath).catch(() => undefined);
  }
}

export default withAuth(uploadMessageFile);

