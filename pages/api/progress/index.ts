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
import { loadEnrollmentProgress } from '@/lib/progress-views';
import { updateLearningLevelIfEligible } from '@/lib/learning-level';

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
      { projection: { instructorId: 1 } }
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
      course: course ? { _id: course._id } : null,
      lesson: lesson ? { _id: lesson._id, courseId: lesson.courseId } : null,
      enrollment: enrollmentDecisionRecord(enrollment),
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    const progress = db.collection('progress');
    const courseProgress = await progress.findOne({
      userId: decision.userId,
      courseId: decision.courseId,
    });
    if (!courseProgress) {
      return res.status(403).json({ error: 'Unable to update progress' });
    }

    const completedLessons = Array.isArray(courseProgress.completedLessons)
      ? courseProgress.completedLessons.slice()
      : [];
    if (!completedLessons.includes(decision.lessonId)) {
      completedLessons.push(decision.lessonId);
    }
    const courseLessons = await db.collection('lessons').find({ courseId: decision.courseId }).toArray();
    const progressPercent = courseLessons.length > 0
      ? (completedLessons.length / courseLessons.length) * 100
      : 0;
    await progress.updateOne(
      { userId: decision.userId, courseId: decision.courseId },
      {
        $set: {
          completedLessons,
          progress: progressPercent,
          updatedAt: new Date(),
        },
      }
    );

    updateLearningLevelIfEligible(decision.userId).catch(() => {
      console.error(JSON.stringify({ event: 'learningLevel', result: 'failed' }));
    });

    res.json({ success: true, progress: progressPercent });
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

