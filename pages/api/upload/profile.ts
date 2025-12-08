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
import path from 'path';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadProfilePhoto(req: AuthRequest, res: NextApiResponse) {
  try {
    const form = formidable({
      uploadDir: path.join(process.cwd(), 'public', 'uploads', 'profiles'),
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB
      filter: ({ name, originalFilename, mimetype }) => {
        // Only allow image files
        if (name === 'profilePhoto' && mimetype && mimetype.startsWith('image/')) {
          return true;
        }
        return false;
      },
    });

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'profiles');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const [fields, files] = await form.parse(req);

    const file = Array.isArray(files.profilePhoto) ? files.profilePhoto[0] : files.profilePhoto;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique filename
    const fileExt = path.extname(file.originalFilename || '');
    const uniqueFilename = `${req.user!.userId}-${Date.now()}${fileExt}`;
    const newPath = path.join(uploadDir, uniqueFilename);

    // Move file to final location
    fs.renameSync(file.filepath, newPath);

    // Generate URL
    const imageUrl = `/uploads/profiles/${uniqueFilename}`;

    // Update user profile photo in database
    const db = await getDb();
    const users = db.collection('users');

    await users.updateOne(
      { _id: new ObjectId(req.user!.userId) },
      {
        $set: {
          profilePhoto: imageUrl,
          updatedAt: new Date(),
        },
      }
    );

    res.json({
      success: true,
      imageUrl,
      message: 'Profile photo uploaded successfully',
    });
  } catch (error: any) {
    console.error('Profile photo upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 5MB limit' });
    }
    res.status(500).json({ error: error.message || 'Failed to upload profile photo' });
  }
}

export default withAuth(uploadProfilePhoto);







