/**
 * Profile Photo Upload API Route
 * Handles profile photo uploads for users
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import formidable from 'formidable';
import fs from 'fs';
import { uploadImageFromPath, validateImageFile, deleteImage, isCloudinaryConfigured } from '@/lib/cloudinary';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadProfilePhoto(req: AuthRequest, res: NextApiResponse) {
  try {
    // Use /tmp for temporary file storage (works in both serverless and regular environments)
    const form = formidable({
      uploadDir: '/tmp',
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      filter: ({ name, originalFilename, mimetype }) => {
        // Only allow image files
        if (name === 'profilePhoto' && mimetype && mimetype.startsWith('image/')) {
          return true;
        }
        return false;
      },
    });

    const [fields, files] = await form.parse(req);

    const file = Array.isArray(files.profilePhoto) ? files.profilePhoto[0] : files.profilePhoto;

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

    // Get old profile photo to delete it from Cloudinary if it exists
    const db = await getDb();
    const users = db.collection('users');
    const user = await users.findOne({ _id: new ObjectId(req.user!.userId) });
    const oldProfilePhotoPublicId = user?.profilePhotoPublicId;

    // Upload to Cloudinary directly from file path (more efficient)
    const uploadResult = await uploadImageFromPath(file.filepath, 'profiles', {
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

    // Update user profile photo in database with Cloudinary URL
    await users.updateOne(
      { _id: new ObjectId(req.user!.userId) },
      {
        $set: {
          profilePhoto: uploadResult.secureUrl,
          profilePhotoPublicId: uploadResult.publicId, // Store public ID for future deletion
          updatedAt: new Date(),
        },
      }
    );

    // Delete old profile photo from Cloudinary asynchronously (don't block response)
    if (oldProfilePhotoPublicId) {
      deleteImage(oldProfilePhotoPublicId).catch((error) => {
        console.error('Failed to delete old profile photo from Cloudinary:', error);
        // Don't fail the request if deletion fails
      });
    }

    res.json({
      success: true,
      imageUrl: uploadResult.secureUrl,
      message: 'Profile photo uploaded successfully',
    });
  } catch (error: any) {
    console.error('Profile photo upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    if (error.message?.includes('Cloudinary configuration is missing')) {
      return res.status(500).json({ error: 'Image upload service is not configured. Please contact support.' });
    }
    res.status(500).json({ error: error.message || 'Failed to upload profile photo' });
  }
}

export default withAuth(uploadProfilePhoto);










