/**
 * GET /api/lessons/:id/document?item=pdf|r<n>
 *
 * Opens one lesson document (the lesson PDF or a resource) for a member who may read the lesson.
 * The full lesson read rule runs on every request (readLessonDetail: account, enrollment, course
 * state, Phase 6 paywall), then the response redirects to the stored link. Nothing is cached, and
 * the referrer is not passed to the document host. See lib/lesson-documents.js.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { isStoredId } from '@/lib/account-access';
import { readLessonDetail } from '@/lib/course-lesson-list';
import { isDocumentItem, resolveLessonDocument, setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const lessonId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const item = Array.isArray(req.query.item) ? req.query.item[0] : req.query.item;
  if (!isStoredId(lessonId)) return res.status(400).json({ error: 'Invalid lesson ID' });
  if (!isDocumentItem(item)) return res.status(400).json({ error: 'Invalid document' });
  try {
    const db = await getDb();
    const { status, body } = await readLessonDetail(db, { userId: req.user!.userId, lessonId });
    if (status !== 200) {
      // Paywall refusals carry `message` and `locked`; read-rule refusals carry `error`.
      const locked = body.locked === true;
      return res.status(status).json({
        error: String((locked ? body.message : body.error) || 'Unable to access lesson'),
        ...(locked ? { code: 'lesson_locked' } : {}),
      });
    }
    const url = resolveLessonDocument(body, item);
    if (!url) return res.status(404).json({ error: 'This document is not available.' });
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Location', url);
    return res.status(302).json({ ok: true });
  } catch {
    console.error(JSON.stringify({ event: 'lessonDocument', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler);
