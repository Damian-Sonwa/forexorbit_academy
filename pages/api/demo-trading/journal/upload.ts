/**
 * Trade Journal Screenshot Upload API
 * Allows students to upload screenshots of their demo trading activities
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

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
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'demo-trading');
    
    // Create upload directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const form = formidable({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      filter: (part) => {
        return part.mimetype?.startsWith('image/') || false;
      },
    });

    const [fields, files] = await form.parse(req);
    const fileArray = Array.isArray(files.file) ? files.file : files.file ? [files.file] : [];

    if (fileArray.length === 0) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const file = fileArray[0];
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique filename with user ID and timestamp
    const timestamp = Date.now();
    const originalName = file.originalFilename || 'screenshot';
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    const newFileName = `journal_${req.user!.userId}_${timestamp}_${baseName}${ext}`;
    const newFilePath = path.join(uploadDir, newFileName);

    // Rename file
    fs.renameSync(file.filepath, newFilePath);

    // Return the URL path
    const url = `/uploads/demo-trading/${newFileName}`;

    res.status(200).json({
      success: true,
      url,
      filename: newFileName,
    });
  } catch (error: any) {
    console.error('Journal screenshot upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    res.status(500).json({ error: 'Failed to upload screenshot' });
  }
}

export default withAuth(uploadJournalScreenshot, ['student']);

