/**
 * GET /api/quizzes/history?page=&limit=  (Phase 9)
 *
 * The session's own quiz results across all courses, newest first, including results from before
 * Phase 9. Identity comes from the session only; nothing in the request names a student. Summaries
 * only: questions, answers and answer keys stay behind each quiz's review policy.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { assessmentHistory } from '@/lib/quiz-attempts';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

const wholeNumber = (v: string | string[] | undefined) => {
  const text = Array.isArray(v) ? v[0] || '' : v || '';
  return /^[1-9]\d{0,6}$/.test(text) ? Number(text) : undefined;
};

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = await getDb();
    return res.json(await assessmentHistory(db, {
      userId: req.user!.userId,
      page: wholeNumber(req.query.page),
      limit: wholeNumber(req.query.limit),
    }));
  } catch {
    console.error(JSON.stringify({ event: 'quizHistory', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler);
