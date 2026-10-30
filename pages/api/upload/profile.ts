import { publicUploadFailure, unexpectedBody } from '@/lib/public-error';
/**
 * Profile Photo Upload API Route
 * Handles profile photo uploads for users
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { currentPhotoId, removeProfilePhoto, replaceProfilePhoto } from '@/lib/profile-photo';
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
      console.error('Image upload service is not configured');
      return res.status(500).json({
        error: 'Image upload service is not configured. Please contact support.',
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

    // The photo in use now; it is replaced only if the account still has it after the upload.
    const db = await getDb();
    const previousPublicId = await currentPhotoId(db, req.user!.userId);

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

    // Record the new photo, then delete the old one (lib/profile-photo.js). An upload that cannot
    // be recorded is deleted again, so no unreferenced copy is left behind.
    const replaced = await replaceProfilePhoto(db, {
      userId: req.user!.userId,
      previousPublicId,
      upload: { secureUrl: uploadResult.secureUrl, publicId: uploadResult.publicId },
      deleteImage,
    });
    if (!replaced.ok) {
      return res.status(replaced.status).json({ error: replaced.error, code: replaced.code });
    }

    res.json({
      success: true,
      imageUrl: uploadResult.secureUrl,
      message: 'Profile photo uploaded successfully',
    });
  } catch (error: any) {
    const failure = publicUploadFailure(error, { limitMessage: 'File size exceeds 10MB limit' });
    return res.status(failure.status).json(failure.body);
  }
}

/** DELETE: remove the account's photo (record first, then the stored file). */
async function deleteProfilePhoto(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const result = await removeProfilePhoto(db, { userId: req.user!.userId, deleteImage });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json({ success: true, removed: result.removed });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('profile photo delete', error));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'POST') return uploadProfilePhoto(req, res);
  if (req.method === 'DELETE') return deleteProfilePhoto(req, res);
  res.setHeader('Allow', ['POST', 'DELETE']);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);










