/**
 * Certificate Download API Route
 * Generates and returns certificate as PDF/image
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function downloadCertificate(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const certificates = db.collection('certificates');
    const courses = db.collection('courses');
    const users = db.collection('users');

    const certificate = await certificates.findOne({ _id: new ObjectId(id as string) });

    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    // Check permissions
    if (req.user!.role === 'student' && certificate.userId !== req.user!.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const course = await courses.findOne({ _id: new ObjectId(certificate.courseId) });
    const user = await users.findOne({ _id: new ObjectId(certificate.userId) });

    if (!course || !user) {
      return res.status(404).json({ error: 'Course or user not found' });
    }

    // Generate certificate HTML (for now, return JSON - can be extended to generate PDF)
    const certificateData = {
      certificateId: certificate.certificateId,
      studentName: user.name,
      courseName: course.title,
      completionDate: new Date(certificate.issuedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      platformName: 'ForexOrbit Academy',
      issuedAt: certificate.issuedAt,
    };

    // For now, return JSON. In production, you'd generate a PDF using libraries like pdfkit or puppeteer
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${certificate.certificateId}.json"`);
    res.json(certificateData);
  } catch (error: any) {
    console.error('Download certificate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(downloadCertificate);

