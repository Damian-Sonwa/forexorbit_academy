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
    // Detect serverless environment (Vercel uses /var/task)
    const isServerless = process.env.VERCEL === '1' || process.cwd().includes('/var/task');
    
    // Use /tmp in serverless (only writable location), public/uploads in regular Node.js
    const tempDir = isServerless ? '/tmp' : path.join(process.cwd(), 'public', 'uploads', 'demo-trading');
    const finalDir = isServerless 
      ? path.join('/tmp', 'uploads', 'demo-trading')
      : path.join(process.cwd(), 'public', 'uploads', 'demo-trading');
    
    // Ensure final directory exists
    try {
      if (!fs.existsSync(finalDir)) {
        fs.mkdirSync(finalDir, { recursive: true });
      }
    } catch (dirError: any) {
      console.error('Directory creation error:', dirError);
      // If directory creation fails in serverless, try /tmp directly
      if (isServerless) {
        try {
          if (!fs.existsSync('/tmp')) {
            // /tmp should always exist, but just in case
            throw new Error('Cannot access /tmp directory');
          }
        } catch (tmpError: any) {
          return res.status(500).json({ error: 'Serverless environment error: Cannot access temporary storage' });
        }
      }
    }

    const form = formidable({
      uploadDir: tempDir, // Formidable will use this for initial upload
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
    
    // Ensure final directory exists before moving file
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }
    const newPath = path.join(finalDir, uniqueFilename);

    // Move file to final location - simple rename like profile upload
    fs.renameSync(file.filepath, newPath);

    // Generate URL - in serverless, we'll need to serve via API route
    // For now, use the same pattern but note it won't work as static file in serverless
    const imageUrl = isServerless 
      ? `/api/demo-trading/journal/screenshot/${uniqueFilename}` // API route to serve from /tmp
      : `/uploads/demo-trading/${uniqueFilename}`; // Static file in regular Node.js

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
        filePath: isServerless ? newPath : imageUrl, // Store actual path in serverless, URL otherwise
        fileSize: file.size || 0,
        mimeType: file.mimetype || 'image/jpeg',
        isServerless: isServerless, // Flag to know how to serve
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

