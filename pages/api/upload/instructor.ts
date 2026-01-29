/**
 * Instructor Image Upload API
 * Handles file uploads for instructor images using Cloudinary
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import formidable from 'formidable';
import fs from 'fs';
import { uploadImageFromPath, validateImageFile, isCloudinaryConfigured } from '@/lib/cloudinary';

// Disable default body parser to allow file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadInstructorImage(req: AuthRequest, res: NextApiResponse) {
  try {
    // Use /tmp for temporary file storage (works in both serverless and regular environments)
    const form = formidable({
      uploadDir: '/tmp',
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      filter: ({ name, originalFilename, mimetype }) => {
        // Only allow image files
        if (name === 'image' && mimetype && mimetype.startsWith('image/')) {
          return true;
        }
        return false;
      },
    });

    const [fields, files] = await form.parse(req);

    const file = Array.isArray(files.image) ? files.image[0] : files.image;
    
    if (!file) {
      return res.status(400).json({ error: 'No image file provided' });
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
      const missing = [];
      if (!process.env.CLOUDINARY_CLOUD_NAME) missing.push('CLOUDINARY_CLOUD_NAME');
      if (!process.env.CLOUDINARY_API_KEY) missing.push('CLOUDINARY_API_KEY');
      if (!process.env.CLOUDINARY_API_SECRET) missing.push('CLOUDINARY_API_SECRET');
      console.error('Cloudinary not configured - missing environment variables:', missing.join(', '));
      return res.status(500).json({ 
        error: 'Image upload service is not configured. Please contact support.',
        details: `Missing: ${missing.join(', ')}`
      });
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
    const uploadResult = await uploadImageFromPath(file.filepath, 'instructors', {
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

    res.status(200).json({
      success: true,
      url: uploadResult.secureUrl,
      imageUrl: uploadResult.secureUrl, // Support both response formats
      publicId: uploadResult.publicId,
      filename: uploadResult.publicId.split('/').pop() || 'image',
    });
  } catch (error: any) {
    console.error('Instructor image upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    if (error.message?.includes('Cloudinary configuration is missing')) {
      return res.status(500).json({ error: 'Image upload service is not configured. Please contact support.' });
    }
    res.status(500).json({ error: error.message || 'Failed to upload instructor image' });
  }
}

export default withAuth(uploadInstructorImage, ['admin', 'superadmin']);

