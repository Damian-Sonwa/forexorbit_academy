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

    // Ensure lessonSummary exists - if summary field exists but lessonSummary doesn't, create it
    if (lesson.summary && !lesson.lessonSummary) {
      lesson.lessonSummary = {
        overview: lesson.summary,
        updatedAt: lesson.updatedAt || lesson.createdAt || new Date(),
      };
    }

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

    // Check if lesson exists
    const lesson = await lessons.findOne({ _id: new ObjectId(id as string) });
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Instructors, admins, and superadmins can edit any lesson (full access)
    const userRole = req.user!.role;
    console.log('Update lesson - User role:', userRole, 'User:', req.user!.email);
    if (userRole !== 'admin' && userRole !== 'instructor' && userRole !== 'superadmin') {
      console.log('Access denied - Role not authorized:', userRole);
      return res.status(403).json({ error: 'Not authorized', role: userRole });
    }

    // Get existing lesson to preserve lessonSummary fields
    const existingLesson = await lessons.findOne({ _id: new ObjectId(id as string) });
    const existingLessonSummary = existingLesson?.lessonSummary || {};

    const updateData: any = {
      ...req.body,
      updatedAt: new Date(),
    };

    // Handle lessonSummary updates - preserve existing fields and merge new ones
    if (req.body.lessonSummary || req.body.summary !== undefined) {
      updateData.lessonSummary = {
        ...existingLessonSummary,
        ...(req.body.lessonSummary || {}),
        ...(req.body.summary !== undefined ? { overview: req.body.summary } : {}),
        updatedAt: new Date(),
      };
    }

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
    const quizzes = db.collection('quizzes');

    // Check if lesson exists
    const lesson = await lessons.findOne({ _id: new ObjectId(id as string) });
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Instructors, admins, and superadmins can delete any lesson (full access)
    if (req.user!.role !== 'admin' && req.user!.role !== 'instructor' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Delete lesson and associated quiz
    await lessons.deleteOne({ _id: new ObjectId(id as string) });
    await quizzes.deleteOne({ lessonId: id });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete lesson error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // GET is allowed for all authenticated users (students, instructors, admins)
    return getLesson(req, res);
  } else if (req.method === 'PUT') {
    // PUT is restricted to instructors, admins, and superadmins
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    return updateLesson(req, res);
  } else if (req.method === 'DELETE') {
    // DELETE is restricted to instructors, admins, and superadmins
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    return deleteLesson(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Allow all authenticated users (students, instructors, admins, superadmins) to access GET
// PUT and DELETE are protected within the handler
export default withAuth(handler);

