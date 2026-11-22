/**
 * AI lesson development for one lesson (course owners: assigned instructor, admins, Super Admin).
 *
 * GET  ?proposal=<id>&version=<id>    provider status, proposals, history (and one in full)
 * POST { action: 'generate', mode, sectionKind?, instructions?, insertAfter?, regenerate? }
 * POST { action: 'accept', proposalId, baseRevision, confirmLive?, acceptStale?, createQuiz? }
 * POST { action: 'reject', proposalId }
 * POST { action: 'restore', historyId, baseRevision, confirmLive? }
 *
 * Generating, accepting and restoring follow the course's edit rule (instructors: drafts only;
 * admins: any state, with confirmation for a live course). Students and other instructors are
 * refused by lib/course-builder-access.ts. A proposal never changes the lesson; see lib/lesson-ai.js.
 */

import type { NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { isStoredId } from '@/lib/account-access';
import { loadOwnedCourse } from '@/lib/course-builder-access';
import { acceptProposal, generateProposal, readAi, rejectProposal, restoreVersion } from '@/lib/lesson-ai';
import { publicProviderStatus } from '@/lib/ai-provider';
import { aiLessonDailyLimiter, aiLessonLimiter, allowRequest, authoringLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const COURSE_FIELDS = { title: 1, summary: 1, description: 1, difficulty: 1, category: 1, objectives: 1, modules: 1 };

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  const lessonId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(lessonId)) return res.status(400).json({ error: 'Invalid lesson ID' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = await getDb();
    const lesson = await db.collection('lessons').findOne({ _id: new ObjectId(lessonId) }, { projection: { courseId: 1 } });
    if (!lesson || !isStoredId(String(lesson.courseId))) return res.status(404).json({ error: 'Lesson not found' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = req.method === 'GET' ? 'read' : String(body.action || '');
    const owned = await loadOwnedCourse(db, req, String(lesson.courseId), COURSE_FIELDS, { edit: action !== 'read' && action !== 'reject' });
    if (!owned.ok) return res.status(owned.status).json({ error: owned.error, code: owned.code });
    const input = { member: owned.member, course: owned.course, lessonId, body };

    if (action === 'read') {
      const read = await readAi(db, { course: owned.course, lessonId, proposalId: typeof req.query.proposal === 'string' ? req.query.proposal : undefined, historyId: typeof req.query.version === 'string' ? req.query.version : undefined });
      if (!read.ok) return res.status(read.status).json({ error: read.error, code: read.code });
      return res.json({ ...read, provider: publicProviderStatus() });
    }
    if (action === 'generate') {
      if (!publicProviderStatus().configured) return res.status(503).json({ error: publicProviderStatus().reason, code: 'not_configured' });
      if (!(await allowRequest(aiLessonLimiter, { userId: req.user!.userId, res, getDb }))) return;
      if (!(await allowRequest(aiLessonDailyLimiter, { userId: req.user!.userId, res, getDb }))) return;
      const result = await generateProposal(db, { member: owned.member, course: owned.course, lessonId, request: body });
      if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
      return res.status(result.status).json({ proposal: result.proposal, reused: result.reused === true });
    }
    if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const run = action === 'accept' ? acceptProposal : action === 'reject' ? rejectProposal : action === 'restore' ? restoreVersion : null;
    if (!run) return res.status(400).json({ error: 'Unknown action.' });
    const result = await run(db, input);
    if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
    return res.json(result);
  } catch {
    console.error(JSON.stringify({ event: 'lessonAi', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);
