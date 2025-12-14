/**
 * Lesson Detail API Route
 * GET: Get lesson by ID
 * PUT: Update lesson (admin/instructor only)
 * DELETE: Delete lesson (admin/instructor only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getLesson(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const lessons = db.collection('lessons');
    const quizzes = db.collection('quizzes');
    const progress = db.collection('progress');
    const courses = db.collection('courses');

    const lesson = await lessons.findOne({ _id: new ObjectId(id as string) });
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Level-based access control: Check if user has required level
    if (lesson.requiredLevel && req.user) {
      const course = await courses.findOne({ _id: new ObjectId(lesson.courseId) });
      if (course) {
        const levelOrder = { beginner: 1, intermediate: 2, advanced: 3 };
        const courseLevel = (course.difficulty || 'beginner').toLowerCase();
        const requiredLevel = lesson.requiredLevel.toLowerCase();
        
        if (levelOrder[requiredLevel as keyof typeof levelOrder] > levelOrder[courseLevel as keyof typeof levelOrder]) {
          // Check user's progress in prerequisite courses
          const prerequisiteProgress = await progress.findOne({
            userId: req.user.userId,
            courseId: course._id.toString(),
            progress: { $gte: 100 }, // Completed
          });

          if (!prerequisiteProgress && req.user.role === 'student') {
            return res.status(403).json({ 
              error: 'This lesson requires completing prerequisite courses',
              requiredLevel: lesson.requiredLevel,
            });
          }
        }
      }
    }

    // Get quiz for this lesson
    const quiz = await quizzes.findOne({ lessonId: id });
    lesson.quiz = quiz;

    // Get progress if authenticated
    if (req.user) {
      const userProgress = await progress.findOne({
        userId: req.user.userId,
        courseId: lesson.courseId,
      });
      lesson.completed = userProgress?.completedLessons?.includes(id as string) || false;
    }

    res.json(lesson);
  } catch (error: any) {
    console.error('Get lesson error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateLesson(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const lessons = db.collection('lessons');

    const updateData = {
      ...req.body,
      updatedAt: new Date(),
    };

    await lessons.updateOne(
      { _id: new ObjectId(id as string) },
      { $set: updateData }
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Update lesson error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteLesson(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const lessons = db.collection('lessons');

    await lessons.deleteOne({ _id: new ObjectId(id as string) });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete lesson error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getLesson(req, res);
  } else if (req.method === 'PUT') {
    return updateLesson(req, res);
  } else if (req.method === 'DELETE') {
    return deleteLesson(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);

