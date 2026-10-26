import { unexpectedBody } from '@/lib/public-error';
/**
 * Quiz API Route
 * GET: Get quiz for a lesson
 * POST: Submit quiz and get results
 * PUT: Create/Update quiz (admin/instructor only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { decideAccountAccess, decideQuizMutation, decideQuizRead, decideQuizSubmit } from '@/lib/account-access';
import { enrollmentDecisionRecord } from '@/lib/enrollment-state';

function routeLessonId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

async function loadQuizContext(userId: string, lessonId: string) {
  const db = await getDb();
  const record = await db.collection('users').findOne(
    { _id: new ObjectId(userId) },
    { projection: { email: 1, role: 1, status: 1 } }
  );
  const account = decideAccountAccess({ userId, record });
  const lesson = await db.collection('lessons').findOne(
    { _id: new ObjectId(lessonId) },
    { projection: { courseId: 1, requiredLevel: 1 } }
  );
  let course = null;
  let enrollment = null;
  if (lesson && lesson.courseId != null && ObjectId.isValid(String(lesson.courseId))) {
    course = await db.collection('courses').findOne(
      { _id: new ObjectId(String(lesson.courseId)) },
      { projection: { instructorId: 1, difficulty: 1 } }
    );
    if (account.ok && course) {
      const courseId = String(course._id);
      enrollment = await db.collection('progress').findOne({
        userId: account.user.userId,
        $or: [{ courseId }, { courseId: course._id }],
      });
    }
  }
  const quiz = await db.collection('quizzes').findOne({ lessonId });
  return {
    db,
    member: account.ok ? account.user : null,
    lesson: lesson ? {
      _id: lesson._id,
      courseId: lesson.courseId,
      requiredLevel: typeof lesson.requiredLevel === 'string' ? lesson.requiredLevel : null,
    } : null,
    course: course ? {
      _id: course._id,
      instructorId: course.instructorId,
      difficulty: typeof course.difficulty === 'string' ? course.difficulty : null,
    } : null,
    enrollment: enrollmentDecisionRecord(enrollment),
    quiz: quiz ? { questions: quiz.questions } : null,
  };
}

async function getQuiz(req: AuthRequest, res: NextApiResponse) {
  const lessonId = routeLessonId(req.query.lessonId);
  if (!ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const loaded = await loadQuizContext(req.user!.userId, lessonId);
    const decision = decideQuizRead(loaded);
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }
    res.json({
      lessonId: decision.lessonId,
      courseId: decision.courseId,
      questions: decision.questions,
    });
  } catch {
    console.error(JSON.stringify({ event: 'quizRead', result: 'lookup_failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function submitQuiz(req: AuthRequest, res: NextApiResponse) {
  const lessonId = routeLessonId(req.query.lessonId);
  if (!ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const loaded = await loadQuizContext(req.user!.userId, lessonId);
    const decision = decideQuizSubmit({
      member: loaded.member,
      lesson: loaded.lesson,
      course: loaded.course,
      enrollment: loaded.enrollment,
      quiz: loaded.quiz,
      answers: req.body?.answers,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    await loaded.db.collection('quizScores').insertOne({
      userId: decision.userId,
      lessonId: decision.lessonId,
      courseId: decision.courseId,
      score: decision.score,
      answers: req.body.answers,
      createdAt: new Date(),
    });

    const progress = loaded.db.collection('progress');
    const courseProgress = await progress.findOne({
      userId: decision.userId,
      courseId: decision.courseId,
    });
    if (courseProgress) {
      const completedLessons = Array.isArray(courseProgress.completedLessons)
        ? courseProgress.completedLessons.slice()
        : [];
      if (!completedLessons.includes(decision.lessonId)) {
        completedLessons.push(decision.lessonId);
      }
      const courseLessons = await loaded.db.collection('lessons').find({ courseId: decision.courseId }).toArray();
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
    }

    res.json({
      score: decision.score,
      correct: decision.correct,
      total: decision.total,
      results: decision.results,
    });
  } catch {
    console.error(JSON.stringify({ event: 'quizSubmit', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function createQuiz(req: AuthRequest, res: NextApiResponse) {
  const routeLessonId = Array.isArray(req.query.lessonId) ? req.query.lessonId[0] : req.query.lessonId;
  const lessonId = typeof routeLessonId === 'string' ? routeLessonId : '';
  if (!ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (typeof req.body?.lessonId === 'string' && req.body.lessonId !== lessonId) {
    return res.status(400).json({ error: 'Missing required fields' });
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
    const decision = decideQuizMutation({
      member: account.ok ? account.user : null,
      lesson,
      course,
      questions: req.body?.questions,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    const quizzes = db.collection('quizzes');
    const existing = await quizzes.findOne({ lessonId: decision.lessonId });
    if (existing) {
      await quizzes.updateOne(
        { lessonId: decision.lessonId },
        { $set: { courseId: decision.courseId, questions: decision.questions, updatedAt: new Date() } }
      );
      res.json({ success: true, id: existing._id.toString() });
    } else {
      const result = await quizzes.insertOne({
        lessonId: decision.lessonId,
        courseId: decision.courseId,
        questions: decision.questions,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      res.status(201).json({ success: true, id: result.insertedId.toString() });
    }
  } catch {
    console.error(JSON.stringify({ event: 'quizMutation', result: 'lookup_failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getQuiz(req, res);
  } else if (req.method === 'POST') {
    return submitQuiz(req, res);
  } else if (req.method === 'PUT') {
    return createQuiz(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);


