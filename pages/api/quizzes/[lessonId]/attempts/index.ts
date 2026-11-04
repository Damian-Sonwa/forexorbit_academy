/**
 * /api/quizzes/:lessonId/attempts  (Phase 9)
 *
 * GET   Students: their own attempts on this quiz and whether they may start another.
 *       Course instructor / admins: finished attempts of all students, ?page=&limit= (results
 *       queue; the summary covers all of them).
 * POST  Students: start an attempt, or resume the one in progress. The server checks access
 *       (enrollment, paywall, course state), publication, the availability window and the attempt
 *       limit, freezes the questions (and their shuffled order) and sets the deadline.
 *
 * Identity always comes from the session; nothing in the request names a student.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { presentAttempt, quizSettings } from '@/lib/quiz-assessment';
import { attemptOverview, loadQuizContext, quizResults, startAttempt } from '@/lib/quiz-attempts';
import { allowRequest, assessmentLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

type Refusal = { ok: false; status: number; error: string; code?: string };
const refused = (res: NextApiResponse, r: Refusal) => res.status(r.status).json(r.code ? { error: r.error, code: r.code } : { error: r.error });
const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] || '' : v || '');
const wholeNumber = (v: string | string[] | undefined) => {
  const text = param(v);
  return /^[1-9]\d{0,6}$/.test(text) ? Number(text) : undefined;
};

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const lessonId = param(req.query.lessonId);
  try {
    const db = await getDb();
    if (req.method === 'POST' && !(await allowRequest(assessmentLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const ctx = await loadQuizContext(db, { userId: req.user!.userId, lessonId, withAnswerKey: req.method === 'POST' });
    if (!ctx.ok) return refused(res, ctx);
    if (!ctx.quiz || !Array.isArray(ctx.quiz.questions)) return res.status(404).json({ error: 'Quiz not found' });
    if (req.method === 'GET') {
      if (ctx.staff) return res.json(await quizResults(db, ctx, { page: wholeNumber(req.query.page), limit: wholeNumber(req.query.limit) }));
      if (quizSettings(ctx.quiz).status !== 'published') return res.status(404).json({ error: 'Quiz not found' });
      return res.json(await attemptOverview(db, ctx));
    }
    const started = await startAttempt(db, ctx);
    if (!started.ok) return refused(res, started as Refusal);
    return res.status(started.resumed ? 200 : 201).json({ resumed: started.resumed, attempt: presentAttempt(started.attempt) });
  } catch {
    console.error(JSON.stringify({ event: 'quizAttempts', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler);
