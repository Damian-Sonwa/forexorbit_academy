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
        // Only allow specific image types: jpg, jpeg, png
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        return part.mimetype ? allowedTypes.includes(part.mimetype.toLowerCase()) : false;
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

    // Validate file type more strictly
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png'];
    const fileExt = path.extname(file.originalFilename || '').toLowerCase();
    
    if (!allowedExtensions.includes(fileExt)) {
      return res.status(400).json({ error: 'Invalid file type. Only JPG, JPEG, and PNG images are allowed.' });
    }

    if (file.mimetype && !allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid file type. Only JPG, JPEG, and PNG images are allowed.' });
    }

    // Generate unique filename with user ID and timestamp
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const sanitizedExt = fileExt || '.jpg';
    const newFileName = `journal_${req.user!.userId}_${timestamp}_${randomString}${sanitizedExt}`;
    const newFilePath = path.join(uploadDir, newFileName);

    // Ensure the file was actually uploaded
    if (!fs.existsSync(file.filepath)) {
      return res.status(400).json({ error: 'File upload failed. Please try again.' });
    }

    // Move/rename file to final location
    try {
      fs.renameSync(file.filepath, newFilePath);
    } catch (renameError: any) {
      console.error('File rename error:', renameError);
      return res.status(500).json({ error: 'Failed to save uploaded file' });
    }

    // Verify file was saved
    if (!fs.existsSync(newFilePath)) {
      return res.status(500).json({ error: 'File was not saved correctly' });
    }

    // Return the URL path (absolute path for production compatibility)
    const url = `/uploads/demo-trading/${newFileName}`;

    res.status(200).json({
      success: true,
      url,
      imageUrl: url, // Alias for compatibility
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

