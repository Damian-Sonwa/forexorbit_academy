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
import path from 'path';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadMessageFile(req: AuthRequest, res: NextApiResponse) {
  try {
    const form = formidable({
      uploadDir: path.join(process.cwd(), 'public', 'uploads', 'consultations'),
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB limit
    });

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'consultations');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const [fields, files] = await form.parse(req);

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const sessionId = Array.isArray(fields.sessionId) ? fields.sessionId[0] : fields.sessionId;
    const type = Array.isArray(fields.type) ? fields.type[0] : fields.type;

    if (!file || !sessionId || !type) {
      return res.status(400).json({ error: 'File, sessionId, and type are required' });
    }

    // Generate unique filename
    const fileExt = path.extname(file.originalFilename || '');
    const uniqueFilename = `${Date.now()}-${Math.random().toString(36).substring(7)}${fileExt}`;
    const newPath = path.join(uploadDir, uniqueFilename);

    // Move file to final location
    fs.renameSync(file.filepath, newPath);

    // Generate URL
    const fileUrl = `/uploads/consultations/${uniqueFilename}`;

    // Verify session access
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

    if ((req.user!.role === 'instructor' || req.user!.role === 'admin') 
        && session.expertId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (session.status !== 'active') {
      return res.status(400).json({ error: 'Session is not active' });
    }

    // Get sender info
    const sender = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { name: 1, profilePhoto: 1 } }
    );

    const message = {
      sessionId,
      senderId: req.user!.userId,
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
    console.error('Upload consultation message file error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 50MB limit' });
    }
    res.status(500).json({ error: error.message || 'Failed to upload file' });
  }
}

export default withAuth(uploadMessageFile);








