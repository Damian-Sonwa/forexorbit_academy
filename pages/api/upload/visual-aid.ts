/**
 * Visual Aid Image Upload API
 * Allows instructors and admins to upload images for lesson visual aids
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
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'visual-aids');
    
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

    // Generate unique filename
    const timestamp = Date.now();
    const originalName = file.originalFilename || 'image';
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    const newFileName = `${baseName}_${timestamp}${ext}`;
    const newFilePath = path.join(uploadDir, newFileName);

    // Rename file
    fs.renameSync(file.filepath, newFilePath);

    // Return the URL path
    const url = `/uploads/visual-aids/${newFileName}`;

    res.status(200).json({
      success: true,
      url,
      filename: newFileName,
    });
  } catch (error: any) {
    console.error('Visual aid upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    res.status(500).json({ error: 'Failed to upload image' });
  }
}

export default withAuth(uploadVisualAid, ['instructor', 'admin', 'superadmin']);

