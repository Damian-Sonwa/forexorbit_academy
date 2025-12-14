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

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'instructors');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

async function uploadInstructorImage(req: AuthRequest, res: NextApiResponse): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
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

      form.parse(req, (err, fields, files) => {
        if (err) {
          console.error('Upload error:', err);
          const errorMessage = err.message || 'Failed to upload file';
          res.status(400).json({ error: errorMessage });
          return resolve(undefined);
        }

        const file = Array.isArray(files.image) ? files.image[0] : files.image;
        
        if (!file) {
          res.status(400).json({ error: 'No image file provided' });
          return resolve(undefined);
        }

        // Check if file.filepath exists
        if (!file.filepath) {
          res.status(400).json({ error: 'File upload failed - no file path' });
          return resolve(undefined);
        }

        // Generate unique filename
        const timestamp = Date.now();
        const ext = path.extname(file.originalFilename || file.newFilename || '');
        const filename = `instructor-${timestamp}${ext || '.jpg'}`;
        const filepath = path.join(uploadDir, filename);
        const publicUrl = `/uploads/instructors/${filename}`;

        // Rename/move the file to the final location
        try {
          // Ensure the directory exists
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          
          // Copy file instead of rename to handle cross-device issues
          fs.copyFileSync(file.filepath, filepath);
          // Remove temporary file
          try {
            fs.unlinkSync(file.filepath);
          } catch (unlinkErr) {
            // Ignore unlink errors
            console.warn('Could not remove temp file:', unlinkErr);
          }
          
          res.status(200).json({
            url: publicUrl,
            filename: filename,
          });
          resolve(undefined);
        } catch (copyError: any) {
          console.error('Copy error:', copyError);
          res.status(500).json({ error: copyError.message || 'Failed to save file' });
          resolve(undefined);
        }
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
      resolve(undefined);
    }
  });
}

export default withAuth(uploadInstructorImage, ['admin']);

