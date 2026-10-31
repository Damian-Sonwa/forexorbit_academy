import { unexpectedBody } from '@/lib/public-error';
/**
 * Lesson Summary API Route
 * PUT: Update lesson summary for the assigned instructor, an admin, or a superadmin.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { decideAccountAccess, decideLessonUpdate, isStoredId } from '@/lib/account-access';
import { allowRequest, authoringLimiter } from '@/lib/content-rate-limit';

async function updateLessonSummary(req: AuthRequest, res: NextApiResponse) {
  const lessonId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(lessonId)) {
    return res.status(400).json({ error: 'Invalid lesson ID' });
  }

  try {
    const db = await getDb();
    if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const record = await db.collection('users').findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, role: 1, status: 1 } }
    );
    const account = decideAccountAccess({ userId: req.user!.userId, record });
    const lesson = await db.collection('lessons').findOne(
      { _id: new ObjectId(lessonId) },
      { projection: { courseId: 1, lessonSummary: 1 } }
    );
    let course = null;
    if (lesson && lesson.courseId != null && isStoredId(String(lesson.courseId))) {
      course = await db.collection('courses').findOne(
        { _id: new ObjectId(String(lesson.courseId)) },
        { projection: { instructorId: 1, status: 1 } }
      );
    }
    const decision = decideLessonUpdate({
      member: account.ok ? { userId: account.user.userId, role: account.user.role } : null,
      lesson: lesson ? { _id: lesson._id, courseId: lesson.courseId } : null,
      course: course ? { _id: course._id, instructorId: course.instructorId, status: course.status } : null,
      patch: { lessonSummary: req.body?.lessonSummary },
    });
    if (!decision.ok) {
      const refused = decision as { status: number; error: string; code?: string };
      return res.status(refused.status).json({ error: refused.error, code: refused.code });
    }

    const existingSummary = lesson && lesson.lessonSummary && typeof lesson.lessonSummary === 'object'
      ? lesson.lessonSummary
      : {};
    const $set: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (decision.patch.lessonSummary && typeof decision.patch.lessonSummary === 'object') {
      $set.lessonSummary = {
        ...existingSummary,
        overview: decision.patch.lessonSummary.overview,
        screenshots: [],
        updatedAt: new Date(),
      };
      if (typeof decision.patch.lessonSummary.overview === 'string') {
        $set.content = decision.patch.lessonSummary.overview;
      }
    }

    await db.collection('lessons').updateOne(
      { _id: new ObjectId(decision.lessonId) },
      { $set }
    );

    res.json({
      success: true,
      message: 'Lesson summary updated successfully',
    });
  } catch {
    console.error(JSON.stringify({ event: 'lessonSummaryUpdate', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(updateLessonSummary);
