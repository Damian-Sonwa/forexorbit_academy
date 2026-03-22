/**
 * Lessons API Route
 * GET: List lessons for a course
 * POST: Create new lesson (admin/instructor only)
 */

import type { NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16mb',
    },
  },
};
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { buildLessonsListForCourse } from '@/lib/build-course-lessons-list';

async function getLessons(req: AuthRequest, res: NextApiResponse) {
  try {
    const { courseId } = req.query;
    if (!courseId) {
      return res.status(400).json({ message: 'courseId required' });
    }

    const db = await getDb();
    const list = await buildLessonsListForCourse(db, courseId as string, req.user);
    return res.json(list);
  } catch (error: any) {
    console.error('Get lessons error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

async function createLesson(req: AuthRequest, res: NextApiResponse) {
  try {
    // Instructors, admins, and superadmins can create lessons
    const userRole = req.user!.role;
    console.log('Create lesson - User role:', userRole, 'User:', req.user!.email);
    if (userRole !== 'admin' && userRole !== 'instructor' && userRole !== 'superadmin') {
      console.log('Access denied - Role not authorized:', userRole);
      return res.status(403).json({ message: 'Not authorized', role: userRole });
    }

    const { courseId, title, description, summary, videoUrl, pdfUrl, order, content, type, requiredLevel, resources } = req.body;

    if (!courseId || !title) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const db = await getDb();
    const lessons = db.collection('lessons');

    const result = await lessons.insertOne({
      courseId,
      title,
      description,
      summary: summary || null, // Short text overview for the topic
      videoUrl: videoUrl || null,
      pdfUrl: pdfUrl || null, // Support PDF lessons
      type: type || 'video', // 'video', 'pdf', 'interactive'
      order: order || 0,
      content,
      resources: resources || [], // Array of resources: { type: 'pdf'|'link'|'slide', url: string, title: string }
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
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getLessons(req, res);
  } else if (req.method === 'POST') {
    return createLesson(req, res);
  } else {
    return res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withAuth(handler);

