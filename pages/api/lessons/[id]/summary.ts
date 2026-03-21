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

    const existing = await lessons.findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const existingSummary = (existing as any).lessonSummary || {};
    const mergedSummary = {
      ...existingSummary,
      ...lessonSummary,
      updatedAt: new Date(),
    };

    const $set: Record<string, unknown> = {
      lessonSummary: mergedSummary,
      updatedAt: new Date(),
    };

    // Keep top-level `content` in sync with overview (HTML / migration)
    if (lessonSummary && typeof (lessonSummary as any).overview === 'string') {
      $set.content = (lessonSummary as any).overview;
    }

    const result = await lessons.updateOne({ _id: new ObjectId(id) }, { $set });

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








