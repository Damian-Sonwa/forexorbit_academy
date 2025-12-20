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

    let fields, files;
    try {
      [fields, files] = await form.parse(req);
    } catch (parseError: any) {
      console.error('Formidable parse error:', parseError);
      console.error('Parse error details:', {
        message: parseError.message,
        code: parseError.code,
        stack: parseError.stack
      });
      return res.status(400).json({ error: `Failed to parse upload: ${parseError.message || 'Unknown error'}` });
    }
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
    if (!file.filepath || !fs.existsSync(file.filepath)) {
      return res.status(400).json({ error: 'File upload failed. Please try again.' });
    }

    // Move/rename file to final location
    try {
      // Ensure target directory exists
      const targetDir = path.dirname(newFilePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.renameSync(file.filepath, newFilePath);
    } catch (renameError: any) {
      console.error('File rename error:', renameError);
      console.error('Source path:', file.filepath);
      console.error('Target path:', newFilePath);
      return res.status(500).json({ error: `Failed to save uploaded file: ${renameError.message}` });
    }

    // Verify file was saved
    if (!fs.existsSync(newFilePath)) {
      console.error('File not found after rename:', newFilePath);
      return res.status(500).json({ error: 'File was not saved correctly' });
    }

    // Get file stats
    let fileSize = 0;
    try {
      const fileStats = fs.statSync(newFilePath);
      fileSize = fileStats.size;
    } catch (statError: any) {
      console.error('File stat error:', statError);
      // Continue with 0 size if we can't get stats
    }

    // Generate URL path
    const url = `/uploads/demo-trading/${newFileName}`;

    // Save screenshot metadata to database
    let insertResult = null;
    try {
      const db = await getDb();
      const screenshots = db.collection('Screenshots');

      const screenshotDoc = {
        studentId: req.user!.userId,
        filename: newFileName,
        originalFilename: file.originalFilename || 'screenshot',
        url: url,
        filePath: url,
        fileSize: fileSize,
        mimeType: file.mimetype || 'image/jpeg',
        uploadedAt: new Date(),
        createdAt: new Date(),
      };

      insertResult = await screenshots.insertOne(screenshotDoc);
    } catch (dbError: any) {
      console.error('Database insert error:', dbError);
      // Continue even if DB insert fails - file is still uploaded
    }


    res.status(200).json({
      success: true,
      url,
      imageUrl: url, // Alias for compatibility
      filename: newFileName,
      screenshotId: insertResult?.insertedId?.toString() || null,
    });
  } catch (error: any) {
    console.error('Journal screenshot upload error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    
    // Handle specific error types
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    
    if (error.code === 'ENOENT') {
      return res.status(500).json({ error: 'Upload directory not found. Please contact support.' });
    }
    
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return res.status(500).json({ error: 'Permission denied. File upload not allowed in this environment.' });
    }
    
    // Return detailed error for debugging
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? `${error.message || 'Failed to upload screenshot'} (Code: ${error.code || 'unknown'})`
      : 'Failed to upload screenshot. Please try again or contact support if the issue persists.';
    
    res.status(500).json({ 
      error: errorMessage,
      ...(process.env.NODE_ENV === 'development' && { details: error.stack })
    });
  }
}

export default withAuth(uploadJournalScreenshot, ['student']);

