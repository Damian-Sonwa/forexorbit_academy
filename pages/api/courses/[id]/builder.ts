/**
 * GET /api/courses/:id/builder
 *
 * The course builder's view of one course: details, modules with every lesson's full content, the
 * course's uploaded files, quizzes / assignments / practical tasks attached to lessons, readiness
 * for review, and what this member may do. Owners only (lib/course-builder-access.ts).
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { loadOwnedCourse } from '@/lib/course-builder-access';
import { loadBuilderCourse } from '@/lib/course-curriculum';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = await getDb();
    const owned = await loadOwnedCourse(db, req, Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
    if (!owned.ok) return res.status(owned.status).json({ error: owned.error, code: owned.code });
    return res.json(await loadBuilderCourse(db, owned.member, owned.course));
  } catch {
    console.error(JSON.stringify({ event: 'courseBuilderRead', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);
