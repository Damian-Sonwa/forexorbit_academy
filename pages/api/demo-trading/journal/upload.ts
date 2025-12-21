/**
 * Trade Journal Screenshot Upload API
 * Allows students to upload screenshots of their demo trading activities
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import formidable from 'formidable';
import fs from 'fs';
import { ObjectId } from 'mongodb';
import { uploadImageFromPath, validateImageFile, isCloudinaryConfigured } from '@/lib/cloudinary';

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
    // Use /tmp for temporary file storage (works in both serverless and regular environments)
    const form = formidable({
      uploadDir: '/tmp',
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      filter: ({ name, originalFilename, mimetype }) => {
        // Only allow image files
        if (name === 'file' && mimetype && mimetype.startsWith('image/')) {
          return true;
        }
        return false;
      },
    });

    const [fields, files] = await form.parse(req);

    // Handle both array and single file
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Check if Cloudinary is configured
    if (!isCloudinaryConfigured()) {
      // Clean up temp file
      if (fs.existsSync(file.filepath)) {
        try {
          fs.unlinkSync(file.filepath);
        } catch (unlinkError) {
          // Ignore cleanup errors
        }
      }
      console.error('Cloudinary not configured - missing environment variables');
      return res.status(500).json({ error: 'Image upload service is not configured. Please contact support.' });
    }

    // Validate file using Cloudinary utility
    const validation = validateImageFile({
      mimetype: file.mimetype || undefined,
      size: file.size,
      originalFilename: file.originalFilename || undefined,
    });

    if (!validation.valid) {
      // Clean up temp file
      if (fs.existsSync(file.filepath)) {
        try {
          fs.unlinkSync(file.filepath);
        } catch (unlinkError) {
          // Ignore cleanup errors
        }
      }
      return res.status(400).json({ error: validation.error });
    }

    // Upload to Cloudinary directly from file path (more efficient)
    const uploadResult = await uploadImageFromPath(file.filepath, 'journal-screenshots', {
      userId: req.user!.userId,
    });

    // Clean up temp file after upload
    if (fs.existsSync(file.filepath)) {
      try {
        fs.unlinkSync(file.filepath);
      } catch (unlinkError) {
        // Ignore cleanup errors
      }
    }

    // Save screenshot metadata to database
    const db = await getDb();
    const screenshots = db.collection('Screenshots');

    const screenshotDoc = {
      studentId: req.user!.userId,
      url: uploadResult.secureUrl,
      publicId: uploadResult.publicId, // Store public ID for future deletion
      originalFilename: file.originalFilename || 'screenshot',
      fileSize: uploadResult.bytes || file.size || 0,
      mimeType: file.mimetype || 'image/jpeg',
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
      uploadedAt: new Date(),
      createdAt: new Date(),
    };

    const insertResult = await screenshots.insertOne(screenshotDoc);

    res.json({
      success: true,
      url: uploadResult.secureUrl,
      imageUrl: uploadResult.secureUrl, // Alias for compatibility
      publicId: uploadResult.publicId,
      screenshotId: insertResult.insertedId.toString(),
    });
  } catch (error: any) {
    console.error('Journal screenshot upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    if (error.message?.includes('Cloudinary configuration is missing')) {
      return res.status(500).json({ error: 'Image upload service is not configured. Please contact support.' });
    }
    res.status(500).json({ error: error.message || 'Failed to upload screenshot' });
  }
}

export default withAuth(uploadJournalScreenshot, ['student']);

