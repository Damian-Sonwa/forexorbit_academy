/**
 * Instructor Image Upload API
 * Handles file uploads for instructor images
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

// Disable default body parser to allow file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadInstructorImage(req: AuthRequest, res: NextApiResponse) {
  try {
    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'instructors');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const form = formidable({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB limit
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

    // Generate unique filename
    const timestamp = Date.now();
    const ext = path.extname(file.originalFilename || '');
    const filename = `instructor-${timestamp}${ext}`;
    const filepath = path.join(uploadDir, filename);
    const publicUrl = `/uploads/instructors/${filename}`;

    // Rename/move the file to the final location
    try {
      fs.renameSync(file.filepath, filepath);
      res.status(200).json({
        url: publicUrl,
        filename: filename,
      });
    } catch (renameError: any) {
      console.error('Rename error:', renameError);
      res.status(500).json({ error: 'Failed to save file' });
    }
  } catch (error: any) {
    console.error('Upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 5MB limit' });
    }
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(uploadInstructorImage, ['admin', 'superadmin']);

