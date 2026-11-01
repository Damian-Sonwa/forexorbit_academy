import { unexpectedBody } from '@/lib/public-error';
/**
 * Progress API Route
 * GET: Get user progress for all courses
 * POST: Update lesson progress
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { decideAccountAccess, decideProgressUpdate } from '@/lib/account-access';
import { enrollmentDecisionRecord } from '@/lib/enrollment-state';
import { recordLessonCompletion } from '@/lib/course-progress';
import { loadEnrollmentProgress } from '@/lib/progress-views';
import { updateLearningLevelIfEligible } from '@/lib/learning-level';
import { courseContentAccess, LESSON_LOCKED_MESSAGE } from '@/lib/course-lesson-list';

async function getProgress(req: AuthRequest, res: NextApiResponse) {
  try {
    const userId = req.user!.userId;
    const db = await getDb();
    // Batched: a fixed number of queries per request instead of three per enrollment.
    const enrichedProgress = await loadEnrollmentProgress(db, userId);

    res.json(enrichedProgress);
  } catch (error: any) {
    console.error('Get progress error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

async function updateProgress(req: AuthRequest, res: NextApiResponse) {
  const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId : '';
  const lessonId = typeof req.body?.lessonId === 'string' ? req.body.lessonId : '';
  if (!ObjectId.isValid(courseId) || !ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const db = await getDb();
    const record = await db.collection('users').findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, role: 1, status: 1 } }
    );
    const account = decideAccountAccess({ userId: req.user!.userId, record });
    const course = await db.collection('courses').findOne(
      { _id: new ObjectId(courseId) },
      { projection: { instructorId: 1, status: 1 } }
    );
    const lesson = await db.collection('lessons').findOne(
      { _id: new ObjectId(lessonId) },
      { projection: { courseId: 1 } }
    );
    let enrollment = null;
    if (account.ok && course) {
      enrollment = await db.collection('progress').findOne({
        userId: account.user.userId,
        $or: [{ courseId: String(course._id) }, { courseId: course._id }],
      });
    }
    const decision = decideProgressUpdate({
      member: account.ok ? account.user : null,
      course: course ? { _id: course._id, status: course.status } : null,
      lesson: lesson ? { _id: lesson._id, courseId: lesson.courseId } : null,
      enrollment: enrollmentDecisionRecord(enrollment),
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }
    // Only a lesson the student may open can be completed: a free preview, a demo lesson, or a
    // lesson of a course they hold the entitlement for (Phase 6). Enrollment alone is not enough.
    const access = await courseContentAccess(db, account.ok ? account.user : null, decision.courseId);
    if (!access.isOpen(decision.lessonId)) {
      return res.status(403).json({ error: LESSON_LOCKED_MESSAGE, code: 'lesson_locked' });
    }

    // Atomic ($addToSet), measured against the course's current lessons and never above 100;
    // completedAt is recorded once and kept (lib/course-progress.js, Decision 4).
    const recorded = await recordLessonCompletion(db, {
      userId: decision.userId,
      courseId: decision.courseId,
      lessonId: decision.lessonId,
    });
    if (!recorded) {
      return res.status(403).json({ error: 'Unable to update progress' });
    }
    const progressPercent = recorded.progress;

    updateLearningLevelIfEligible(decision.userId).catch(() => {
      console.error(JSON.stringify({ event: 'learningLevel', result: 'failed' }));
    });

    // Phase 8: every open tab and device of this account learns the persisted result (the
    // personal room `user:<id>` joined by server.js on connect). Clients still refetch from the
    // server on focus, so a missed event only delays the update.
    req.io?.to(`user:${decision.userId}`).emit('progressUpdated', {
      courseId: decision.courseId,
      lessonId: decision.lessonId,
      progress: progressPercent,
      completedAt: recorded.completedAt || null,
    });

    res.json({ success: true, progress: progressPercent, completedAt: recorded.completedAt });
  } catch {
    console.error(JSON.stringify({ event: 'progressUpdate', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getProgress(req, res);
  } else if (req.method === 'POST') {
    return updateProgress(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Allow all authenticated users to access their own progress
export default withAuth(handler);

