import { unexpectedBody } from '@/lib/public-error';
/**
 * Staff progress aggregate.
 * Instructors see their assigned courses. Admins and superadmins see every course.
 * Students are denied. The response has no lesson ids, quiz scores, or contact details.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { activeEnrollmentFilter } from '@/lib/enrollment-state';
import { summarizeStaffProgress } from '@/lib/staff-progress';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const role = req.user!.role;
  if (role === 'student') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  try {
    const db = await getDb();
    const difficulty = typeof req.query.difficulty === 'string' ? req.query.difficulty : '';
    const courseId = typeof req.query.courseId === 'string' ? req.query.courseId : '';
    const courses = await db.collection('courses').find({}).project({
      title: 1,
      difficulty: 1,
      instructorId: 1,
    }).toArray();
    const rows = await db.collection('progress').find(activeEnrollmentFilter()).project({
      userId: 1,
      courseId: 1,
      progress: 1,
      active: 1,
      withdrawnAt: 1,
    }).toArray();
    const summary = summarizeStaffProgress({
      role,
      userId: req.user!.userId,
      courses,
      rows,
      difficulty,
      courseId,
    });
    if (!summary.ok) {
      return res.status(summary.status).json({ error: summary.error });
    }
    return res.status(200).json({ courses: summary.courses, totals: summary.totals });
  } catch {
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);
