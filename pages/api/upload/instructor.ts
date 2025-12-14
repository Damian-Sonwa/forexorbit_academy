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
    // FIX: Use /tmp for serverless environments (Vercel, etc.) - public folder is read-only
    const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
    const tempDir = isServerless ? '/tmp' : path.join(process.cwd(), 'public', 'uploads', 'instructors');
    
    // Ensure upload directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const form = formidable({
      uploadDir: tempDir,
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
    
    // FIX: For serverless environments, convert to base64 and return data URL
    // For non-serverless, save to public/uploads
    if (isServerless) {
      // Read file and convert to base64
      const fileBuffer = fs.readFileSync(file.filepath);
      const base64Image = fileBuffer.toString('base64');
      const mimeType = file.mimetype || 'image/jpeg';
      const dataUrl = `data:${mimeType};base64,${base64Image}`;
      
      // Clean up temp file
      try {
        fs.unlinkSync(file.filepath);
      } catch (unlinkErr) {
        console.warn('Could not remove temp file:', unlinkErr);
      }

      // FIX: Return both 'url' and 'imageUrl' for compatibility
      return res.status(200).json({
        url: dataUrl,
        imageUrl: dataUrl,
        filename: filename,
        success: true,
      });
    }

    // Non-serverless: Save to public/uploads
    const filepath = path.join(tempDir, filename);
    const publicUrl = `/uploads/instructors/${filename}`;

    // FIX: Handle file operations for serverless environments
    // Check if the file is already in the target directory (common in serverless setups)
    if (file.filepath === filepath) {
      // File is already in the correct location
      // FIX: Return both 'url' and 'imageUrl' for compatibility
      res.status(200).json({
        url: publicUrl,
        imageUrl: publicUrl,
        filename: filename,
        success: true,
      });
      return;
    }

    // Copy file instead of rename to handle cross-device issues
    try {
      // Ensure the directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Use copyFileSync instead of renameSync for better cross-platform compatibility
      fs.copyFileSync(file.filepath, filepath);
      
      // Remove temporary file (ignore errors if it fails)
      try {
        fs.unlinkSync(file.filepath);
      } catch (unlinkErr) {
        // Ignore unlink errors - file might already be removed or in use
        console.warn('Could not remove temp file:', unlinkErr);
      }
      
      // FIX: Return both 'url' and 'imageUrl' for compatibility
      res.status(200).json({
        url: publicUrl,
        imageUrl: publicUrl,
        filename: filename,
        success: true,
      });
    } catch (copyError: any) {
      console.error('Copy error:', copyError);
      res.status(500).json({ 
        error: copyError.message || 'Failed to save file. Please try again.' 
      });
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

