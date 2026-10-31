/**
 * POST /api/courses/:id/status   Body: { status: 'draft' | 'in_review' | 'published' | 'archived' }
 *
 * Course lifecycle change (Phase 4, Decision 1). Who may make which change is decided in
 * lib/course-lifecycle.js; the change is written only if the course is still in the state that
 * was checked, so two simultaneous changes cannot both apply. Every change is recorded in the
 * admin audit log.
 */
import type { NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { isStoredId } from '@/lib/account-access';
import { decideCourseTransition } from '@/lib/course-lifecycle';
import { AUDIT_COLLECTION } from '@/lib/course-payment';
import { allowRequest, authoringLimiter } from '@/lib/content-rate-limit';
import { unexpectedBody } from '@/lib/public-error';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const courseId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(courseId)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }
  try {
    const db = await getDb();
    if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const course = await db.collection('courses').findOne(
      { _id: new ObjectId(courseId) },
      { projection: { instructorId: 1, status: 1, title: 1 } }
    );
    const member = { userId: req.user!.userId, role: req.user!.role };
    const to = req.body && typeof req.body === 'object' ? req.body.status : undefined;
    const decision = decideCourseTransition({ member, course, to });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error, code: decision.code });
    }
    const now = new Date();
    const written = await db.collection('courses').updateOne(
      { _id: new ObjectId(decision.courseId), ...decision.filter },
      { $set: { status: decision.to, statusChangedAt: now, statusChangedBy: String(member.userId), updatedAt: now } }
    );
    if (!written.matchedCount) {
      return res.status(409).json({ error: 'The course changed meanwhile. Reload and try again.', code: 'course_changed' });
    }
    try {
      await db.collection(AUDIT_COLLECTION).insertOne({
        entityType: 'course',
        entityId: decision.courseId,
        reference: null,
        action: `course_${decision.to}`,
        reason: '',
        before: { status: decision.from },
        after: { status: decision.to },
        actor: { userId: String(member.userId), email: typeof req.user!.email === 'string' ? req.user!.email : null },
        createdAt: now,
      });
    } catch {
      console.error(JSON.stringify({ event: 'courseStatus', courseId: decision.courseId, result: 'audit_write_failed' }));
    }
    return res.status(200).json({ success: true, courseId: decision.courseId, from: decision.from, status: decision.to });
  } catch {
    console.error(JSON.stringify({ event: 'courseStatus', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);
