import { publicUploadFailure } from '@/lib/public-error';
/**
 * Consultation Message File Upload API Route
 * Handles file uploads for consultation messages (images, videos, documents, audio)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import formidable from 'formidable';
import fs from 'fs';
import os from 'os';
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
    const sessionId = Array.isArray(fields.sessionId) ? fields.sessionId[0] : fields.sessionId;
    const type = Array.isArray(fields.type) ? fields.type[0] : fields.type;
    if (file) tempPath = file.filepath;

    if (!file || !sessionId || !type) {
      return res.status(400).json({ error: 'File, sessionId, and type are required' });
    }

    // Pages, SVG and scripts would run from this site's origin; they are refused (lib/upload-safety.js).
    if (isActiveContent({ originalFilename: file.originalFilename, mimetype: file.mimetype })) {
      return res.status(400).json({ error: 'This file type cannot be shared. Send an image, video, audio or document file.', code: 'file_type_not_allowed' });
    }
    if (typeof sessionId !== 'string' || !ObjectId.isValid(sessionId) || sessionId.length !== 24) {
      return res.status(400).json({ error: 'Invalid session' });
    }

    // Verify session access (before the file is stored)
    const db = await getDb();
    const sessions = db.collection('consultationSessions');
    const messages = db.collection('consultationMessages');
    const users = db.collection('users');

    const session = await sessions.findOne({ _id: new ObjectId(sessionId) });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (req.user!.role === 'student' && session.studentId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if ((req.user!.role === 'instructor' || req.user!.role === 'admin' || req.user!.role === 'superadmin') 
        && session.expertId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (session.status !== 'active') {
      return res.status(400).json({ error: 'Session is not active' });
    }

    // Store privately; the message links to the authorized reader route.
    const messageId = new ObjectId();
    const attachment = await storeChatAttachment(file.filepath, 'consultation-chat');
    const fileUrl = attachmentPath('consultation', messageId.toString());

    // Get sender info
    const sender = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { name: 1, profilePhoto: 1 } }
    );

    const message = {
      _id: messageId,
      sessionId,
      senderId: req.user!.userId,
      attachment,
      type,
      content: file.originalFilename || 'File',
      fileUrl,
      fileName: file.originalFilename || 'file',
      fileSize: file.size,
      createdAt: new Date(),
    };

    const result = await messages.insertOne(message);

    // Update session
    await sessions.updateOne(
      { _id: new ObjectId(sessionId) },
      { 
        $push: { messages: result.insertedId },
        $set: { updatedAt: new Date() }
      } as any
    );

    // Emit socket event
    if (req.io) {
      const messageToEmit = {
        ...message,
        _id: result.insertedId.toString(),
        senderName: sender?.name || 'Unknown',
        senderPhoto: sender?.profilePhoto || null,
      };

      req.io.to(`user:${session.studentId}`).emit('consultationMessage', messageToEmit);
      req.io.to(`user:${session.expertId}`).emit('consultationMessage', messageToEmit);
    }

    res.json({
      success: true,
      message: {
        ...message,
        _id: result.insertedId.toString(),
        senderName: sender?.name || 'Unknown',
        senderPhoto: sender?.profilePhoto || null,
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








