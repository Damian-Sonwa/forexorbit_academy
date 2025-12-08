/**
 * Certificate Upload API Route (Admin Only)
 * POST: Upload certificate template for a course level
 * Certificates uploaded here will be available to all students who complete courses of that level
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    bodyParser: false,
  },
};

const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'certificates');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

async function uploadCertificate(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const form = formidable({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      filter: ({ name, mimetype }) => {
        if (name === 'certificate' && mimetype && (mimetype.startsWith('image/') || mimetype === 'application/pdf')) {
          return true;
        }
        return false;
      },
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Upload error:', err);
        return res.status(400).json({ error: 'Failed to upload file' });
      }

      const file = Array.isArray(files.certificate) ? files.certificate[0] : files.certificate;
      const level = Array.isArray(fields.level) ? fields.level[0] : fields.level;

      if (!file) {
        return res.status(400).json({ error: 'No certificate file provided' });
      }

      if (!level || !['beginner', 'intermediate', 'advanced'].includes(level as string)) {
        return res.status(400).json({ error: 'Invalid level. Must be beginner, intermediate, or advanced' });
      }

      const timestamp = Date.now();
      const ext = path.extname(file.originalFilename || '');
      const filename = `certificate-${level}-${timestamp}${ext}`;
      const filepath = path.join(uploadDir, filename);
      const publicUrl = `/uploads/certificates/${filename}`;

      fs.renameSync(file.filepath, filepath);

      // Save certificate template to database
      const db = await getDb();
      const certificateTemplates = db.collection('certificateTemplates');

      await certificateTemplates.insertOne({
        level: level as string,
        fileUrl: publicUrl,
        filename: filename,
        uploadedBy: req.user!.userId,
        uploadedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      res.status(200).json({
        success: true,
        url: publicUrl,
        filename: filename,
        level: level,
      });
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(uploadCertificate, ['admin']);










