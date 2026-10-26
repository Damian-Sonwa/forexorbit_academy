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
import { decideAccountAccess, decideLessonDelete, decideLessonRead, decideLessonUpdate, decideQuizRead, isStoredId, presentLessonRead } from '@/lib/account-access';
import { enrollmentDecisionRecord } from '@/lib/enrollment-state';
import { stripLessonVisualAidsFields } from '@/lib/strip-visual-aids-html';

async function getLesson(req: AuthRequest, res: NextApiResponse) {
  const lessonId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(lessonId)) {
    return res.status(400).json({ error: 'Invalid lesson ID' });
  }
  try {
    const db = await getDb();
    const record = await db.collection('users').findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, role: 1, status: 1 } }
    );
    const account = decideAccountAccess({ userId: req.user!.userId, record });
    const lesson = await db.collection('lessons').findOne({ _id: new ObjectId(lessonId) });
    let course = null;
    if (lesson && lesson.courseId != null && isStoredId(String(lesson.courseId))) {
      course = await db.collection('courses').findOne(
        { _id: new ObjectId(String(lesson.courseId)) },
        { projection: { instructorId: 1, difficulty: 1 } }
      );
    }
    const courseId = course ? String(course._id) : '';
    const enrollment = account.ok && course
      ? await db.collection('progress').findOne({
          userId: account.user.userId,
          $or: [{ courseId }, { courseId: course._id }],
        })
      : null;
    const member = account.ok ? { userId: account.user.userId, role: account.user.role, email: account.user.email } : null;
    const lessonRecord = lesson ? {
      _id: lesson._id,
      courseId: lesson.courseId,
      requiredLevel: typeof lesson.requiredLevel === 'string' ? lesson.requiredLevel : null,
    } : null;
    const courseRecord = course ? {
      _id: course._id,
      instructorId: course.instructorId,
      difficulty: typeof course.difficulty === 'string' ? course.difficulty : null,
    } : null;
    const enrollmentRecord = enrollmentDecisionRecord(enrollment);
    const decision = decideLessonRead({
      member,
      lesson: lessonRecord,
      course: courseRecord,
      enrollment: enrollmentRecord,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    const quiz = await db.collection('quizzes').findOne(
      { lessonId: decision.lessonId },
      { projection: { questions: 1 } }
    );
    const quizDecision = decideQuizRead({
      member,
      lesson: lessonRecord,
      course: courseRecord,
      enrollment: enrollmentRecord,
      quiz: quiz ? { questions: quiz.questions } : null,
    });
    const view = presentLessonRead(lesson as Record<string, unknown>, true, courseId);
    if (lesson && lesson.summary && !view.lessonSummary) {
      view.lessonSummary = {
        overview: lesson.summary,
        updatedAt: lesson.updatedAt || lesson.createdAt || new Date(),
      };
    }
    if (quizDecision.ok) {
      view.quiz = {
        lessonId: quizDecision.lessonId,
        courseId: quizDecision.courseId,
        questions: quizDecision.questions,
      };
    }
    view.completed = Boolean(
      enrollment &&
      Array.isArray(enrollment.completedLessons) &&
      enrollment.completedLessons.map(String).includes(decision.lessonId)
    );

    res.json(stripLessonVisualAidsFields(view));
  } catch {
    console.error(JSON.stringify({ event: 'lessonRead', result: 'failed' }));
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateLesson(req: AuthRequest, res: NextApiResponse) {
  const lessonId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(lessonId)) {
    return res.status(400).json({ error: 'Invalid lesson ID' });
  }
  try {
    const db = await getDb();
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
        { projection: { instructorId: 1 } }
      );
    }
    const decision = decideLessonUpdate({
      member: account.ok ? { userId: account.user.userId, role: account.user.role } : null,
      lesson: lesson ? { _id: lesson._id, courseId: lesson.courseId } : null,
      course: course ? { _id: course._id, instructorId: course.instructorId } : null,
      patch: req.body,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
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

    await db.collection('lessons').updateOne(
      { _id: new ObjectId(decision.lessonId) },
      { $set: patch }
    );
    res.json({ success: true });
  } catch {
    console.error(JSON.stringify({ event: 'lessonUpdate', result: 'failed' }));
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteLesson(req: AuthRequest, res: NextApiResponse) {
  const lessonId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (typeof lessonId !== 'string' || !ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'Lesson not found' });
  }
  try {
    const db = await getDb();
    const record = await db.collection('users').findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, role: 1, status: 1 } }
    );
    const account = decideAccountAccess({ userId: req.user!.userId, record });
    const lesson = await db.collection('lessons').findOne(
      { _id: new ObjectId(lessonId) },
      { projection: { courseId: 1 } }
    );
    let course = null;
    if (lesson && lesson.courseId != null && ObjectId.isValid(String(lesson.courseId))) {
      course = await db.collection('courses').findOne(
        { _id: new ObjectId(String(lesson.courseId)) },
        { projection: { instructorId: 1 } }
      );
    }
    const decision = decideLessonDelete({
      member: account.ok ? account.user : null,
      lesson: lesson ? { _id: lesson._id, courseId: lesson.courseId } : null,
      course: course ? { _id: course._id, instructorId: course.instructorId } : null,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    await db.collection('lessons').deleteOne({ _id: new ObjectId(decision.lessonId) });
    await db.collection('quizzes').deleteOne({ lessonId: decision.lessonId });
    res.json({ success: true });
  } catch {
    console.error(JSON.stringify({ event: 'lessonDelete', result: 'failed' }));
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

