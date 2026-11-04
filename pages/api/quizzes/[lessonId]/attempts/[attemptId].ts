/**
 * /api/quizzes/:lessonId/attempts/:attemptId  (Phase 9). Students: the session's own attempt only.
 * The course instructor and admins may GET a finished attempt of this quiz, with the student's
 * answers against the frozen questions and key, and nothing else.
 *
 * GET   The attempt (questions without the answer key, saved answers, server time and deadline).
 *       An attempt whose deadline passed is expired and graded here. The answer key and
 *       explanations appear only when the quiz's review policy allows it.
 * PUT   { questionId, answer }  save one answer (autosave). Refused after the deadline, for a
 *       question not in this attempt, or once the attempt is finished.
 * POST  { answers? }  final submission. Idempotent: repeating it returns the stored result. After
 *       the deadline (plus a short grace for network delay) the attempt is expired and graded on
 *       the answers saved in time. Scores, percentages and pass marks sent by the client are ignored.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { presentAttempt, presentAttemptForStaff } from '@/lib/quiz-assessment';
import { attemptForStaff, loadQuizContext, readAttempt, reviewFor, saveAnswer, submitAttempt } from '@/lib/quiz-attempts';
import { allowRequest, assessmentLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

type Refusal = { ok: false; status: number; error: string; code?: string };
const refused = (res: NextApiResponse, r: Refusal) => res.status(r.status).json(r.code ? { error: r.error, code: r.code } : { error: r.error });
const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] || '' : v || '');

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (!['GET', 'PUT', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed' });
  const lessonId = param(req.query.lessonId);
  const attemptId = param(req.query.attemptId);
  try {
    const db = await getDb();
    if (req.method !== 'GET' && !(await allowRequest(assessmentLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const ctx = await loadQuizContext(db, { userId: req.user!.userId, lessonId });
    if (!ctx.ok) return refused(res, ctx);
    if (ctx.member.role !== 'student') {
      if (req.method !== 'GET' || !ctx.staff) return res.status(404).json({ error: 'Attempt not found' });
      const found = await attemptForStaff(db, ctx, attemptId);
      if (!found.ok) return refused(res, found);
      return res.json({ attempt: presentAttemptForStaff(found.attempt) });
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    let outcome;
    if (req.method === 'GET') outcome = await readAttempt(db, ctx, attemptId);
    else if (req.method === 'PUT') outcome = await saveAnswer(db, ctx, attemptId, body);
    else outcome = await submitAttempt(db, ctx, attemptId, body);
    if (!outcome.ok) return refused(res, outcome as Refusal);
    const review = outcome.attempt.status === 'in_progress' ? false : await reviewFor(db, ctx, outcome.attempt);
    return res.json({
      attempt: presentAttempt(outcome.attempt, { review }),
      ...('alreadyFinal' in outcome && outcome.alreadyFinal ? { alreadySubmitted: true } : {}),
      ...('expired' in outcome && outcome.expired ? { expired: true } : {}),
    });
  } catch {
    console.error(JSON.stringify({ event: 'quizAttempt', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler);
