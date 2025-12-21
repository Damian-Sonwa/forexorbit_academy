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
import path from 'path';
import { canAccessRoom } from '@/lib/learning-level';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadMessageFile(req: AuthRequest, res: NextApiResponse) {
  try {
    const form = formidable({
      uploadDir: path.join(process.cwd(), 'public', 'uploads', 'community'),
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB
    });

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'community');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const [fields, files] = await form.parse(req);

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const roomId = Array.isArray(fields.roomId) ? fields.roomId[0] : fields.roomId;
    const type = Array.isArray(fields.type) ? fields.type[0] : fields.type;

    if (!file || !roomId || !type) {
      return res.status(400).json({ error: 'File, roomId, and type are required' });
    }

    // Generate unique filename
    const fileExt = path.extname(file.originalFilename || '');
    const uniqueFilename = `${Date.now()}-${Math.random().toString(36).substring(7)}${fileExt}`;
    const newPath = path.join(uploadDir, uniqueFilename);

    // Move file to final location
    fs.renameSync(file.filepath, newPath);

    // Generate URL
    const fileUrl = `/uploads/community/${uniqueFilename}`;

    // Save message to database
    const db = await getDb();
    const messages = db.collection('communityMessages');
    const rooms = db.collection('communityRooms');
    const users = db.collection('users');

    // Verify room access
    const room = await rooms.findOne({ _id: new ObjectId(roomId) });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Get user's learning level
    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1, studentDetails: 1 } }
    );

    // Determine user's learning level
    // CRITICAL: Use tradingLevel from onboarding if learningLevel is not set
    let userLevel: 'beginner' | 'intermediate' | 'advanced' = 'beginner';
    if (user?.role !== 'student') {
      userLevel = 'advanced';
    } else {
      userLevel = (user?.learningLevel as 'beginner' | 'intermediate' | 'advanced') || 
                  (user?.studentDetails?.tradingLevel as 'beginner' | 'intermediate' | 'advanced') || 
                  'beginner';
    }

    // Check access for global rooms - students can ONLY access their exact level room
    if (room.type === 'global' && ['Beginner', 'Intermediate', 'Advanced'].includes(room.name)) {
      if (!canAccessRoom(userLevel, room.name, user?.role)) {
        return res.status(403).json({ 
          error: 'Access denied. You can only access the community room for your current level.' 
        });
      }
    }

    // Check access for direct messages
    if (room.type === 'direct' && !room.participants.includes(req.user!.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get sender info
    const sender = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { name: 1, profilePhoto: 1 } }
    );

    const message = {
      roomId,
      senderId: req.user!.userId,
      type,
      content: file.originalFilename || 'File',
      fileUrl,
      fileName: file.originalFilename || 'file',
      fileSize: file.size,
      reactions: [],
      seenBy: [req.user!.userId],
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
        senderId: req.user!.userId,
        senderName: sender?.name || 'Unknown',
        senderPhoto: sender?.profilePhoto || null,
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
        senderName: sender?.name || 'Unknown',
        senderPhoto: sender?.profilePhoto || null,
      },
    });
  } catch (error: any) {
    console.error('Upload message file error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 50MB limit' });
    }
    res.status(500).json({ error: error.message || 'Failed to upload file' });
  }
}

export default withAuth(uploadMessageFile);

