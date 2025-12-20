/**
 * Trade Journal Screenshot Upload API
 * Allows students to upload screenshots of their demo trading activities
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadJournalScreenshot(req: AuthRequest, res: NextApiResponse) {
  // Only students can upload journal screenshots
  if (req.user!.role !== 'student') {
    return res.status(403).json({ error: 'Only students can upload journal screenshots' });
  }

  try {
    // Ensure upload directory exists BEFORE creating formidable instance (like profile upload)
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'demo-trading');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const form = formidable({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      filter: ({ name, originalFilename, mimetype }) => {
        // Only allow image files - match profile upload pattern
        if (name === 'file' && mimetype && mimetype.startsWith('image/')) {
          // Additional check for specific types
          const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
          return allowedTypes.includes(mimetype.toLowerCase());
        }
        return false;
      },
    });

    const [fields, files] = await form.parse(req);

    // Match profile upload pattern - handle both array and single file
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique filename - simpler pattern like profile upload
    const fileExt = path.extname(file.originalFilename || '');
    const uniqueFilename = `journal_${req.user!.userId}_${Date.now()}${fileExt}`;
    const newPath = path.join(uploadDir, uniqueFilename);

    // Move file to final location - simple rename like profile upload
    fs.renameSync(file.filepath, newPath);

    // Generate URL
    const imageUrl = `/uploads/demo-trading/${uniqueFilename}`;

    // Save screenshot metadata to database
    let insertResult = null;
    try {
      const db = await getDb();
      const screenshots = db.collection('Screenshots');

      const screenshotDoc = {
        studentId: req.user!.userId,
        filename: uniqueFilename,
        originalFilename: file.originalFilename || 'screenshot',
        url: imageUrl,
        filePath: imageUrl,
        fileSize: file.size || 0,
        mimeType: file.mimetype || 'image/jpeg',
        uploadedAt: new Date(),
        createdAt: new Date(),
      };

      insertResult = await screenshots.insertOne(screenshotDoc);
    } catch (dbError: any) {
      console.error('Database insert error:', dbError);
      // Continue even if DB insert fails - file is still uploaded
    }

    res.json({
      success: true,
      url: imageUrl,
      imageUrl: imageUrl, // Alias for compatibility
      filename: uniqueFilename,
      screenshotId: insertResult?.insertedId?.toString() || null,
    });
  } catch (error: any) {
    console.error('Journal screenshot upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    res.status(500).json({ error: error.message || 'Failed to upload screenshot' });
  }
}

export default withAuth(uploadJournalScreenshot, ['student']);

