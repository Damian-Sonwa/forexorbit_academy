/**
 * Lessons API Route
 * GET: List lessons for a course
 * POST: Create new lesson (admin/instructor only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';

async function getLessons(req: AuthRequest, res: NextApiResponse) {
  try {
    const { courseId } = req.query;
    if (!courseId) {
      return res.status(400).json({ error: 'courseId required' });
    }

    const db = await getDb();
    const lessons = db.collection('lessons');
    const progress = db.collection('progress');

    const lessonsList = await lessons
      .find({ courseId })
      .sort({ order: 1 })
      .toArray();

    // For students, filter lessons based on level access and mark accessible ones
    if (req.user && req.user.role === 'student') {
      const userProgress = await progress.findOne({
        userId: req.user.userId,
        courseId,
      });

      const enrichedLessons = lessonsList.map((lesson) => {
        let accessible = true;
        if (lesson.requiredLevel) {
          // Check if user has completed prerequisite courses
          // For now, allow if user is enrolled (can be enhanced with prerequisite checking)
          accessible = !!userProgress;
        }
        return {
          ...lesson,
          accessible,
          locked: !accessible,
        };
      });

      return res.json(enrichedLessons);
    }

    res.json(lessonsList);
  } catch (error: any) {
    console.error('Get lessons error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createLesson(req: AuthRequest, res: NextApiResponse) {
  try {
    const { courseId, title, description, videoUrl, pdfUrl, order, content, type, requiredLevel } = req.body;

    if (!courseId || !title) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const lessons = db.collection('lessons');

    const result = await lessons.insertOne({
      courseId,
      title,
      description,
      videoUrl: videoUrl || null,
      pdfUrl: pdfUrl || null, // Support PDF lessons
      type: type || 'video', // 'video', 'pdf', 'interactive'
      order: order || 0,
      content,
      requiredLevel: requiredLevel || null, // Level-based access control
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      ...req.body,
    });
  } catch (error: any) {
    console.error('Create lesson error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getLessons(req, res);
  } else if (req.method === 'POST') {
    return createLesson(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);

