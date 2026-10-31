import { unexpectedBody } from '@/lib/public-error';
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
import { decideAccountAccess, decideLessonDelete, decideLessonUpdate, isStoredId } from '@/lib/account-access';
import { readLessonDetail } from '@/lib/course-lesson-list';
import { stripLessonVisualAidsFields } from '@/lib/strip-visual-aids-html';
import { touchLessonSet } from '@/lib/lesson-order';
import { recomputeCourseProgress } from '@/lib/course-progress';
import { assetsInDocuments, cleanupUnreferencedAssets, removedAssets } from '@/lib/media-cleanup';
import { allowRequest, authoringLimiter } from '@/lib/content-rate-limit';
import { deleteImage } from '@/lib/cloudinary';

/** Lesson fields that can hold uploaded course images (lib/media-cleanup.js). */
const LESSON_MEDIA_PROJECTION = { content: 1, description: 1, summary: 1, title: 1, lessonSummary: 1, videoUrl: 1, pdfUrl: 1, resources: 1 };

function refused(res: NextApiResponse, decision: { status: number; error: string; code?: string; field?: string }) {
  return res.status(decision.status).json({ error: decision.error, code: decision.code, field: decision.field });
}

async function getLesson(req: AuthRequest, res: NextApiResponse) {
  const lessonId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(lessonId)) {
    return res.status(400).json({ error: 'Invalid lesson ID' });
  }
  try {
    const db = await getDb();
    const { status, body } = await readLessonDetail(db, { userId: req.user!.userId, lessonId });
    if (status !== 200) return res.status(status).json(body);
    res.json(stripLessonVisualAidsFields(body));
  } catch {
    console.error(JSON.stringify({ event: 'lessonRead', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function updateLesson(req: AuthRequest, res: NextApiResponse) {
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
      { projection: { courseId: 1, ...LESSON_MEDIA_PROJECTION } }
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
      patch: req.body,
    });
    if (!decision.ok) {
      return refused(res, decision);
    }

    const patch: Record<string, unknown> = {
      ...decision.patch,
      updatedAt: new Date(),
    };
    if (decision.patch.lessonSummary && typeof decision.patch.lessonSummary === 'object') {
      const existingSummary = lesson && lesson.lessonSummary && typeof lesson.lessonSummary === 'object'
        ? lesson.lessonSummary
        : {};
      patch.lessonSummary = {
        ...existingSummary,
        overview: decision.patch.lessonSummary.overview,
        screenshots: [],
        updatedAt: new Date(),
      };
    }

    // An instructor's edit applies only while the course is still a draft (it may have been
    // submitted for review meanwhile); admins edit in any state.
    if (account.ok && account.user.role === 'instructor') {
      const stillDraft = await db.collection('courses').countDocuments({ _id: course!._id, status: 'draft' }, { limit: 1 });
      if (!stillDraft) {
        return res.status(409).json({ error: 'The course is no longer a draft. Reload the page.', code: 'course_not_editable' });
      }
    }
    await db.collection('lessons').updateOne(
      { _id: new ObjectId(decision.lessonId) },
      { $set: patch }
    );
    const dropped = removedAssets(lesson, { ...lesson, ...patch });
    if (dropped.length) {
      await cleanupUnreferencedAssets(db, dropped, { destroy: deleteImage, context: { lessonId: decision.lessonId, reason: 'lesson_update' } });
    }
    res.json({ success: true });
  } catch {
    console.error(JSON.stringify({ event: 'lessonUpdate', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function deleteLesson(req: AuthRequest, res: NextApiResponse) {
  const lessonId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (typeof lessonId !== 'string' || !ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'Lesson not found' });
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
      { projection: { courseId: 1, ...LESSON_MEDIA_PROJECTION } }
    );
    let course = null;
    if (lesson && lesson.courseId != null && ObjectId.isValid(String(lesson.courseId))) {
      course = await db.collection('courses').findOne(
        { _id: new ObjectId(String(lesson.courseId)) },
        { projection: { instructorId: 1, status: 1 } }
      );
    }
    const decision = decideLessonDelete({
      member: account.ok ? account.user : null,
      lesson: lesson ? { _id: lesson._id, courseId: lesson.courseId } : null,
      course: course ? { _id: course._id, instructorId: course.instructorId, status: course.status } : null,
    });
    if (!decision.ok) {
      return refused(res, decision);
    }

    await db.collection('lessons').deleteOne({ _id: new ObjectId(decision.lessonId) });
    await db.collection('quizzes').deleteOne({ lessonId: decision.lessonId });
    // Students' completed-lesson history keeps the id; progress is recounted against the lessons
    // that remain, so it can no longer pass 100 (lib/course-progress.js).
    await touchLessonSet(db, decision.courseId);
    await recomputeCourseProgress(db, decision.courseId);
    const assets = assetsInDocuments([lesson!]);
    if (assets.length) {
      await cleanupUnreferencedAssets(db, assets, { destroy: deleteImage, context: { lessonId: decision.lessonId, reason: 'lesson_delete' } });
    }
    res.json({ success: true });
  } catch {
    console.error(JSON.stringify({ event: 'lessonDelete', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
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

