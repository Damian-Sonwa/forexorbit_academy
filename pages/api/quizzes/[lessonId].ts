import { unexpectedBody } from '@/lib/public-error';
/**
 * Quiz API Route (lesson quiz)
 * GET: Staff (course instructor, admins): the authoring view with the answer key and settings.
 *      Students: a summary (no questions, no answers) and their own attempts.
 * POST: One-step submit kept for older clients: starts (or resumes) an attempt and submits it
 *       through the attempt service, with every Phase 9 rule (limits, availability, scoring,
 *       review policy). Timed or shuffled quizzes need the attempt flow (409 start_required).
 * PUT: Create/Update quiz (admin/instructor only): validated questions with stable ids, settings,
 *      and a version number.
 *
 * Phase 9: docs/audits/phase-9-assessments.md. Attempts: pages/api/quizzes/[lessonId]/attempts.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { decideAccountAccess, decideQuizMutation } from '@/lib/account-access';
import {
  normalizeQuestions,
  normalizeSettings,
  presentAttempt,
  presentQuizForStaff,
  presentQuizSummary,
  quizAvailability,
  quizSettings,
} from '@/lib/quiz-assessment';
import { attemptOverview, loadQuizContext, reviewFor, startAttempt, submitAttempt } from '@/lib/quiz-attempts';
import { allowRequest, assessmentLimiter, authoringLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';

function routeLessonId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

type Refusal = { ok: false; status: number; error: string; code?: string };
const refused = (res: NextApiResponse, r: Refusal) => res.status(r.status).json(r.code ? { error: r.error, code: r.code } : { error: r.error });

async function getQuiz(req: AuthRequest, res: NextApiResponse) {
  const lessonId = routeLessonId(req.query.lessonId);
  if (!ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const db = await getDb();
    const ctx = await loadQuizContext(db, { userId: req.user!.userId, lessonId });
    if (!ctx.ok) return refused(res, ctx);
    if (!ctx.quiz || !Array.isArray(ctx.quiz.questions)) return res.status(404).json({ error: 'Quiz not found' });
    if (ctx.staff) {
      return res.json({ lessonId: ctx.lessonId, courseId: ctx.courseId, ...presentQuizForStaff(ctx.quiz) });
    }
    // Drafts do not exist for students; a closed window still shows their history.
    if (quizSettings(ctx.quiz).status !== 'published') return res.status(404).json({ error: 'Quiz not found' });
    return res.json({
      lessonId: ctx.lessonId,
      courseId: ctx.courseId,
      quiz: presentQuizSummary(ctx.quiz),
      ...(await attemptOverview(db, ctx)),
    });
  } catch {
    console.error(JSON.stringify({ event: 'quizRead', result: 'lookup_failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

/** Older clients post `answers` as an array in the stored question order. */
async function submitQuiz(req: AuthRequest, res: NextApiResponse) {
  const lessonId = routeLessonId(req.query.lessonId);
  if (!ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const answers = req.body && Array.isArray(req.body.answers) ? req.body.answers : null;
  if (!answers) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const db = await getDb();
    if (!(await allowRequest(assessmentLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const ctx = await loadQuizContext(db, { userId: req.user!.userId, lessonId, withAnswerKey: true });
    if (!ctx.ok) return refused(res, ctx);
    const availability = quizAvailability(ctx.quiz);
    if (!availability.ok) return refused(res, availability as Refusal);
    const settings = availability.settings;
    if (settings.timeLimitMinutes || settings.shuffleQuestions || settings.shuffleOptions) {
      return res.status(409).json({ error: 'Start this quiz to take it.', code: 'start_required' });
    }
    const started = await startAttempt(db, ctx);
    if (!started.ok) return refused(res, started as Refusal);
    // Stored order = attempt order (no shuffling here): map positions to question ids.
    const byPosition: Record<string, number | null> = {};
    started.attempt.questions.forEach((q: { id: string }, index: number) => {
      const value = answers[index];
      byPosition[q.id] = Number.isInteger(value) ? value : null;
    });
    const submitted = await submitAttempt(db, ctx, String(started.attempt._id), { answers: byPosition });
    if (!submitted.ok) return refused(res, submitted as Refusal);
    const review = await reviewFor(db, ctx, submitted.attempt);
    const view = presentAttempt(submitted.attempt, { review });
    const result = view.result!;
    return res.json({
      attemptId: view.id,
      score: result.percent,
      correct: result.correctCount,
      total: result.total,
      passed: result.passed,
      reviewAvailable: review,
      results: view.questions.map((q, index) => ({
        question: q.question,
        userAnswer: view.answers[q.id] ?? null,
        ...(review && view.review ? { correctAnswer: view.review[index].correctAnswer, isCorrect: view.review[index].correct } : {}),
      })),
    });
  } catch {
    console.error(JSON.stringify({ event: 'quizSubmit', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function createQuiz(req: AuthRequest, res: NextApiResponse) {
  const lessonId = routeLessonId(req.query.lessonId);
  if (!ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (typeof req.body?.lessonId === 'string' && req.body.lessonId !== lessonId) {
    return res.status(400).json({ error: 'Missing required fields' });
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
      { projection: { courseId: 1 } }
    );
    let course = null;
    if (lesson && lesson.courseId != null && ObjectId.isValid(String(lesson.courseId))) {
      course = await db.collection('courses').findOne(
        { _id: new ObjectId(String(lesson.courseId)) },
        { projection: { instructorId: 1, status: 1 } }
      );
    }
    const normalized = normalizeQuestions(req.body?.questions);
    const decision = decideQuizMutation({
      member: account.ok ? account.user : null,
      lesson,
      course,
      questions: normalized.ok ? normalized.questions : req.body?.questions,
    });
    if (!decision.ok) {
      const refusal = decision as { status: number; error: string; code?: string };
      // The authorization checks come first in decideQuizMutation; a 400 means the caller may
      // edit this quiz and only the content is wrong, so the precise reason can be shown.
      if (refusal.status === 400 && !normalized.ok) {
        return res.status(400).json({ error: normalized.error, code: normalized.code, field: normalized.field });
      }
      return res.status(refusal.status).json(refusal.code ? { error: refusal.error, code: refusal.code } : { error: refusal.error });
    }
    if (!normalized.ok) return res.status(400).json({ error: normalized.error, code: normalized.code, field: normalized.field });

    const quizzes = db.collection('quizzes');
    const existing = await quizzes.findOne({ lessonId: decision.lessonId }, { projection: { settings: 1, status: 1, published: 1 } });
    // quizSettings keeps a legacy quiz's publication state: saving never publishes it by accident.
    const settings = normalizeSettings(req.body?.settings, existing ? quizSettings(existing) : undefined);
    if (!settings.ok) return res.status(400).json({ error: settings.error, code: settings.code, field: settings.field });
    const now = new Date();
    // One quiz per lesson; each save is a new version (attempts keep their own frozen copy).
    const saved = await quizzes.findOneAndUpdate(
      { lessonId: decision.lessonId },
      {
        $set: { courseId: decision.courseId, questions: normalized.questions, settings: settings.settings, updatedAt: now, updatedBy: String(account.ok ? account.user.userId : '') },
        $inc: { version: 1 },
        $setOnInsert: { lessonId: decision.lessonId, createdAt: now },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false }
    );
    return res.status(existing ? 200 : 201).json({ success: true, id: String(saved!._id), ...presentQuizForStaff(saved!) });
  } catch {
    console.error(JSON.stringify({ event: 'quizMutation', result: 'lookup_failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  // Quiz content, answer keys and attempts are per member: never stored by a browser or the CDN.
  setPrivateNoStore(res);
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
