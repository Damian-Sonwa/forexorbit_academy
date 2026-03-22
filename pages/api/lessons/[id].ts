/**
 * Lesson Detail API Route
 * GET: Get lesson by ID
 * PUT: Update lesson (admin/instructor only)
 * DELETE: Delete lesson (admin/instructor only)
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
import { ObjectId } from 'mongodb';
import { stripLessonVisualAidsFields } from '@/lib/strip-visual-aids-html';
import {
  buildLessonLockedBody,
  getMonetizationForLessonDoc,
  isLessonLockedForStudent,
  isStaffRole,
} from '@/lib/lesson-monetization';

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
      return res.status(404).json({ access: false, message: 'Lesson not found' });
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
            return res.status(403).json({ message: 'This lesson requires completing prerequisite courses',
              requiredLevel: lesson.requiredLevel,
            });
          }
        }
      }
    }

    let monetization: Record<string, unknown> | null = null;
    let locked = false;
    if (req.user) {
      const { flags } = await getMonetizationForLessonDoc(db, req.user, lesson as { _id: ObjectId; courseId: string });
      let levelOk = true;
      if (req.user.role === 'student' && (lesson as { requiredLevel?: string }).requiredLevel) {
        const enrollProgress = await progress.findOne({
          userId: req.user.userId,
          courseId: lesson.courseId,
        });
        levelOk = !!enrollProgress;
      }
      locked = isLessonLockedForStudent(flags, levelOk, req.user.role);
      monetization = {
        unlocked: flags.unlocked,
        isFreeTier: flags.isFreeTier,
        isDemo: flags.isDemo,
        requiresPayment: flags.requiresPayment,
        showAds: flags.showAds,
        amountKobo: flags.amountKobo,
        currency: flags.currency,
        paymentsConfigured: flags.paymentsConfigured,
      };
      if (!isStaffRole(req.user.role) && !flags.unlocked) {
        return res
          .status(403)
          .json(buildLessonLockedBody(flags, lesson as { _id: ObjectId; title?: string; courseId: string }));
      }
    }

    // Get quiz for this lesson (only after monetization gate — no quiz leak for locked students)
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

    const lessonOut = stripLessonVisualAidsFields(lesson as Record<string, unknown>) as Record<string, unknown>;
    if (monetization) {
      lessonOut.monetization = monetization;
    }
    lessonOut.access = true;
    lessonOut.isFirstLesson = (lesson as { isFirstLesson?: boolean }).isFirstLesson === true;
    lessonOut.isDemo = (lesson as { isDemo?: boolean }).isDemo === true;
    if (req.user) {
      lessonOut.locked = locked;
    }
    return res.json(lessonOut);
  } catch (error: any) {
    console.error('Get lesson error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again later.' });
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
      return res.status(404).json({ message: 'Lesson not found' });
    }

    // Instructors, admins, and superadmins can edit any lesson (full access)
    const userRole = req.user!.role;
    console.log('Update lesson - User role:', userRole, 'User:', req.user!.email);
    if (userRole !== 'admin' && userRole !== 'instructor' && userRole !== 'superadmin') {
      console.log('Access denied - Role not authorized:', userRole);
      return res.status(403).json({ message: 'Not authorized', role: userRole });
    }

    // Get existing lesson to preserve lessonSummary fields
    const existingLesson = await lessons.findOne({ _id: new ObjectId(id as string) });
    const existingLessonSummary = existingLesson?.lessonSummary || {};

    const updateData: any = {
      ...req.body,
      updatedAt: new Date(),
    };

    // Handle lessonSummary updates - preserve existing fields and merge new ones
    if (req.body.lessonSummary) {
      updateData.lessonSummary = {
        ...existingLessonSummary,
        ...req.body.lessonSummary,
        screenshots: [],
        updatedAt: new Date(),
      };
    }

    // Keep lessonSummary.overview in sync with migrated `content` (rich-text HTML) for legacy readers
    if (typeof req.body.content === 'string') {
      updateData.lessonSummary = {
        ...existingLessonSummary,
        ...(updateData.lessonSummary || {}),
        overview: req.body.content,
        screenshots: [],
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
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
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
      return res.status(404).json({ message: 'Lesson not found' });
    }

    // Instructors, admins, and superadmins can delete any lesson (full access)
    if (req.user!.role !== 'admin' && req.user!.role !== 'instructor' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Delete lesson and associated quiz
    await lessons.deleteOne({ _id: new ObjectId(id as string) });
    await quizzes.deleteOne({ lessonId: id });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete lesson error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // GET is allowed for all authenticated users (students, instructors, admins)
    return getLesson(req, res);
  } else if (req.method === 'PUT') {
    // PUT is restricted to instructors, admins, and superadmins
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    return updateLesson(req, res);
  } else if (req.method === 'DELETE') {
    // DELETE is restricted to instructors, admins, and superadmins
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    return deleteLesson(req, res);
  } else {
    return res.status(405).json({ message: 'Method not allowed' });
  }
}

// Allow all authenticated users (students, instructors, admins, superadmins) to access GET
// PUT and DELETE are protected within the handler
export default withAuth(handler);

