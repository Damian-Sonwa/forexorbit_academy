/**
 * Course Enrollment API Route
 * POST: Enroll in course
 * DELETE: Unenroll from course
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function enroll(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const userId = req.user!.userId;
    const db = await getDb();
    const progress = db.collection('progress');

    // Check if already enrolled
    const existing = await progress.findOne({
      userId,
      courseId: id,
    });

    if (existing) {
      return res.status(400).json({ error: 'Already enrolled' });
    }

    // Create progress entry
    await progress.insertOne({
      userId,
      courseId: id,
      progress: 0,
      completedLessons: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.json({ success: true, enrolled: true });
  } catch (error: any) {
    console.error('Enroll error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function unenroll(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const userId = req.user!.userId;
    const db = await getDb();
    const progress = db.collection('progress');

    await progress.deleteOne({
      userId,
      courseId: id,
    });

    res.json({ success: true, enrolled: false });
  } catch (error: any) {
    console.error('Unenroll error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return enroll(req, res);
  } else if (req.method === 'DELETE') {
    return unenroll(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler, ['student']);

