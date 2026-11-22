/**
 * PUT /api/courses/:id/curriculum   Body: { version, modules: [{ id, title, lessonIds: [] }] }
 *
 * Saves the whole curriculum at once: module order and titles, which module each lesson is in, and
 * the lesson order. The list must contain exactly the course's current lessons. `version` is the
 * curriculumVersion the builder loaded; if any other change to the course's lessons happened since
 * (another editor, a new or deleted lesson), the save is refused with 409 and nothing is written.
 * Progress, quiz attempts, submissions and grades refer to lesson ids and are never changed.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { loadOwnedCourse } from '@/lib/course-builder-access';
import { checkCurriculum } from '@/lib/course-content';
import { applyCurriculum } from '@/lib/course-curriculum';
import { allowRequest, authoringLimiter } from '@/lib/content-rate-limit';
import { unexpectedBody } from '@/lib/public-error';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    const db = await getDb();
    if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const owned = await loadOwnedCourse(db, req, Array.isArray(req.query.id) ? req.query.id[0] : req.query.id, { lessonOrderVersion: 1 }, { edit: true });
    if (!owned.ok) return res.status(owned.status).json({ error: owned.error, code: owned.code });
    const courseId = String(owned.course._id);
    const version = body.version === null || Number.isInteger(body.version) ? body.version : undefined;
    if (version === undefined) return res.status(400).json({ error: 'Reload the builder and try again.', code: 'version_required' });
    const stored = Number.isInteger(owned.course.lessonOrderVersion) ? owned.course.lessonOrderVersion : null;
    if (stored !== version) {
      return res.status(409).json({ error: 'The curriculum was changed in another window or by another editor. Reload to see the latest version.', code: 'curriculum_changed' });
    }
    const current = await db.collection('lessons').find({ courseId }, { projection: { _id: 1 } }).limit(600).toArray();
    const checked = checkCurriculum(body.modules, current.map((l) => String(l._id)));
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error, code: checked.code, field: checked.field });
    const next = await applyCurriculum(db, { courseId, version, modules: checked.modules, assignments: checked.assignments, actorId: owned.member.userId });
    if (next === null) {
      return res.status(409).json({ error: 'The curriculum was changed in another window or by another editor. Reload to see the latest version.', code: 'curriculum_changed' });
    }
    return res.json({ success: true, version: next, modules: checked.modules });
  } catch {
    console.error(JSON.stringify({ event: 'courseCurriculum', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);
