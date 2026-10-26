/**
 * Visual Aid Image Upload API
 * Allows instructors and admins to upload images for lesson visual aids using Cloudinary
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import formidable from 'formidable';
import fs from 'fs';
import { uploadImageFromPath, validateImageFile, isCloudinaryConfigured } from '@/lib/cloudinary';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadVisualAid(req: AuthRequest, res: NextApiResponse) {
  // Log user info for debugging - this should be set by withAuth middleware
  console.log('Upload visual aid - User:', req.user?.email, 'Role:', req.user?.role, 'UserId:', req.user?.userId);
  
  // Verify user is authenticated (should already be verified by withAuth middleware)
  if (!req.user) {
    console.error('No user found in request - Auth middleware may have failed');
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // Role check is already done by withAuth middleware, so we can trust req.user.role
  // Log successful auth for debugging
  console.log('Upload authorized for user:', req.user.email, 'with role:', req.user.role);

  try {
    // Use /tmp for temporary file storage (works in both serverless and regular environments)
    const form = formidable({
      uploadDir: '/tmp',
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
    const uploadResult = await uploadImageFromPath(file.filepath, 'visual-aids', {
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
    console.error('Visual aid upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    if (error.message?.includes('Cloudinary configuration is missing')) {
      return res.status(500).json({ error: 'Image upload service is not configured. Please contact support.' });
    }
    res.status(500).json({ error: error.message || 'Failed to upload image' });
  }
}

export default withAuth(uploadVisualAid, ['instructor', 'admin', 'superadmin']);

