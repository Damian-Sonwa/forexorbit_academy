import { unexpectedBody } from '@/lib/public-error';
/**
 * Certificate API Route (Single Certificate)
 * GET: Get certificate by ID
 * DELETE: Delete certificate (admin only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getCertificate(req: AuthRequest, res: NextApiResponse) {
  try {
    const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (typeof id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid certificate ID' });
    }
    const db = await getDb();
    const certificates = db.collection('certificates');
    const courses = db.collection('courses');
    const users = db.collection('users');

    const certificate = await certificates.findOne({ _id: new ObjectId(id) });

    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const course = ObjectId.isValid(String(certificate.courseId))
      ? await courses.findOne({ _id: new ObjectId(String(certificate.courseId)) })
      : null;

    // A student reads only their own certificates; an instructor only those of their own courses
    // (the same rule as the certificate list); admins and the Super Admin read all.
    const role = req.user!.role;
    if (role === 'student' && String(certificate.userId) !== String(req.user!.userId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (role === 'instructor' && (!course || String(course.instructorId) !== String(req.user!.userId))) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (!['student', 'instructor', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Enrich with course and user details
    const user = ObjectId.isValid(String(certificate.userId))
      ? await users.findOne({ _id: new ObjectId(String(certificate.userId)) })
      : null;

    res.json({
      ...certificate,
      course: course ? {
        id: course._id.toString(),
        title: course.title,
        difficulty: course.difficulty,
        category: course.category,
      } : null,
      user: user ? {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
      } : null,
    });
  } catch (error: any) {
    console.error('Get certificate error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

async function deleteCertificate(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { id } = req.query;
    const db = await getDb();
    const certificates = db.collection('certificates');

    const result = await certificates.deleteOne({ _id: new ObjectId(id as string) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    res.json({ success: true, message: 'Certificate deleted' });
  } catch (error: any) {
    console.error('Delete certificate error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getCertificate(req, res);
  } else if (req.method === 'DELETE') {
    return deleteCertificate(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);












