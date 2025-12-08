/**
 * Lesson Summary API Route
 * PUT: Update lesson summary (instructors only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function updateLessonSummary(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors can update lesson summaries
    if (req.user!.role !== 'instructor') {
      return res.status(403).json({ error: 'Only instructors can update lesson summaries' });
    }

    const { id } = req.query;
    const { lessonSummary } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid lesson ID' });
    }

    const db = await getDb();
    const lessons = db.collection('lessons');

    const result = await lessons.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          lessonSummary: {
            ...lessonSummary,
            updatedAt: new Date(),
          },
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    res.json({
      success: true,
      message: 'Lesson summary updated successfully',
    });
  } catch (error: any) {
    console.error('Update lesson summary error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(updateLessonSummary, ['instructor']);





