/**
 * Certificate Upload API Route (Admin Only)
 * POST: Upload certificate template for a course level using Cloudinary
 * Certificates uploaded here will be available to all students who complete courses of that level
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import formidable from 'formidable';
import fs from 'fs';
import { uploadImageFromPath, isCloudinaryConfigured } from '@/lib/cloudinary';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadCertificate(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    // Use /tmp for temporary file storage (works in both serverless and regular environments)
    const form = formidable({
      uploadDir: '/tmp',
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      filter: ({ name, mimetype }) => {
        if (name === 'certificate' && mimetype && (mimetype.startsWith('image/') || mimetype === 'application/pdf')) {
          return true;
        }
        return false;
      },
    });

    const [fields, files] = await form.parse(req);

    const file = Array.isArray(files.certificate) ? files.certificate[0] : files.certificate;
    const level = Array.isArray(fields.level) ? fields.level[0] : fields.level;

    if (!file) {
      return res.status(400).json({ error: 'No certificate file provided' });
    }

    if (!level || !['beginner', 'intermediate', 'advanced'].includes(level as string)) {
      // Clean up temp file
      if (fs.existsSync(file.filepath)) {
        try {
          fs.unlinkSync(file.filepath);
        } catch (unlinkError) {
          // Ignore cleanup errors
        }
      }
      return res.status(400).json({ error: 'Invalid level. Must be beginner, intermediate, or advanced' });
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

    // Upload to Cloudinary directly from file path (more efficient)
    // Note: Cloudinary supports PDF files as well as images
    const uploadResult = await uploadImageFromPath(file.filepath, 'certificates', {
      userId: req.user!.userId,
      resourceType: 'auto', // 'auto' allows both images and PDFs
    });

    // Clean up temp file after upload
    if (fs.existsSync(file.filepath)) {
      try {
        fs.unlinkSync(file.filepath);
      } catch (unlinkError) {
        // Ignore cleanup errors
      }
    }

    // Save certificate template to database with Cloudinary URL
    const db = await getDb();
    const certificateTemplates = db.collection('certificateTemplates');

    await certificateTemplates.insertOne({
      level: level as string,
      fileUrl: uploadResult.secureUrl,
      publicId: uploadResult.publicId, // Store public ID for future deletion
      filename: uploadResult.publicId.split('/').pop() || 'certificate',
      uploadedBy: req.user!.userId,
      uploadedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      url: uploadResult.secureUrl,
      imageUrl: uploadResult.secureUrl, // Support both response formats
      filename: uploadResult.publicId.split('/').pop() || 'certificate',
      publicId: uploadResult.publicId,
      level: level,
    });
  } catch (error: any) {
    console.error('Certificate upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    if (error.message?.includes('Cloudinary configuration is missing')) {
      return res.status(500).json({ error: 'Image upload service is not configured. Please contact support.' });
    }
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(uploadCertificate, ['admin', 'superadmin']);












