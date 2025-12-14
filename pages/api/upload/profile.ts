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
    // FIX: Use /tmp for serverless environments (Vercel, etc.) - public folder is read-only
    const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
    const tempDir = isServerless ? '/tmp' : path.join(process.cwd(), 'public', 'uploads', 'profiles');
    
    // Ensure upload directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const form = formidable({
      uploadDir: tempDir,
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

    // FIX: For serverless, we'll store the file in /tmp and return a data URL or use cloud storage
    // For now, we'll use /tmp and convert to base64 to store in database
    const uploadDir = tempDir;

    const [fields, files] = await form.parse(req);

    const file = Array.isArray(files.profilePhoto) ? files.profilePhoto[0] : files.profilePhoto;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded. Please select an image file.' });
    }

    // FIX: Generate unique filename with proper extension
    const fileExt = path.extname(file.originalFilename || '') || '.jpg';
    const uniqueFilename = `profile-${req.user!.userId}-${Date.now()}${fileExt}`;
    
    // FIX: For serverless environments, convert to base64 and store in database
    // For non-serverless, save to public/uploads
    if (isServerless) {
      // Read file and convert to base64
      const fileBuffer = fs.readFileSync(file.filepath);
      const base64Image = fileBuffer.toString('base64');
      const mimeType = file.mimetype || 'image/jpeg';
      const dataUrl = `data:${mimeType};base64,${base64Image}`;
      
      // Update user profile photo in database with data URL
      const db = await getDb();
      const users = db.collection('users');
      await users.updateOne(
        { _id: new ObjectId(req.user!.userId) },
        {
          $set: {
            profilePhoto: dataUrl,
            updatedAt: new Date(),
          },
        }
      );

      // Clean up temp file
      try {
        fs.unlinkSync(file.filepath);
      } catch (unlinkErr) {
        console.warn('Could not remove temp file:', unlinkErr);
      }

      return res.status(200).json({
        success: true,
        imageUrl: dataUrl,
        url: dataUrl,
        message: 'Profile photo uploaded successfully',
      });
    }

    // Non-serverless: Save to public/uploads
    const newPath = path.join(uploadDir, uniqueFilename);

    // FIX: Handle file operations for serverless environments
    // Check if the file is already in the target directory (common in serverless setups)
    if (file.filepath === newPath) {
      // File is already in the correct location
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

      return res.status(200).json({
        success: true,
        imageUrl,
        url: imageUrl,
        message: 'Profile photo uploaded successfully',
      });
    }

    // FIX: Use copyFileSync instead of renameSync for better cross-platform compatibility
    try {
      // Ensure the directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      // Copy file instead of rename to handle cross-device issues
      fs.copyFileSync(file.filepath, newPath);
      
      // Remove temporary file (ignore errors if it fails)
      try {
        fs.unlinkSync(file.filepath);
      } catch (unlinkErr) {
        // Ignore unlink errors - file might already be removed or in use
        console.warn('Could not remove temp file:', unlinkErr);
      }
      
      // Generate URL - ensure it starts with / for proper serving
      const imageUrl = `/uploads/profiles/${uniqueFilename}`;

      // FIX: Update user profile photo in database
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

      // FIX: Return both imageUrl and url for compatibility
      res.status(200).json({
        success: true,
        imageUrl,
        url: imageUrl,
        message: 'Profile photo uploaded successfully',
      });
    } catch (copyError: any) {
      console.error('Copy error:', copyError);
      res.status(500).json({ 
        error: copyError.message || 'Failed to save file. Please try again.' 
      });
    }
  } catch (error: any) {
    console.error('Profile photo upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 5MB limit. Please choose a smaller image.' });
    }
    if (error.code === 'ENOENT') {
      return res.status(500).json({ error: 'Upload directory not found. Please contact support.' });
    }
    res.status(500).json({ 
      error: error.message || 'Failed to upload profile photo. Please try again.' 
    });
  }
}

export default withAuth(uploadProfilePhoto);










