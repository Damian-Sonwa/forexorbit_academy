/**
 * GET /api/courses/:courseId/lessons
 * Response: { lessons: [...] } — each lesson includes `locked` (and monetization for students).
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { buildSimpleLessonsWithLocked } from '@/lib/course-lessons-locked';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'courseId required' });
    }

    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      return res.status(400).json({ message: 'Invalid courseId' });
    }

    const db = await getDb();
    const course = await db.collection('courses').findOne({ _id: oid });
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const lessons = await buildSimpleLessonsWithLocked(db, id, req.user);
    return res.status(200).json({ lessons });
  } catch (e) {
    console.error('[courses/:id/lessons]', e);
    return res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(handler);
