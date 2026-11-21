/**
 * /api/admin/courses/:id/reassign  (Phase 12, lib/academic-operations.js)
 * GET   the course's current instructor and its assignment history.
 * POST  { instructorId, reason } reassigns the course to an active instructor.
 *
 * Admins and the Super Admin only (the existing course assignment policy; account approval stays
 * Super Admin only and is unrelated). The change is one conditional update of the course owner:
 * enrollments, progress, quiz history, submissions and grades are untouched, the previous
 * instructor loses access on their next request, and the move is audited and notified.
 */
import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { allowRequest, authoringLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';
import { createNotification } from '@/lib/notifications';
import { reassignCourse, reassignmentHistory, type Notice } from '@/lib/academic-operations';

const queryId = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

async function sendNotices(notices: Notice[]) {
  for (const n of notices) {
    await createNotification({ type: 'system_alert', title: n.title, message: n.message, userId: n.userId, relatedId: n.relatedId, roleTarget: 'instructor', dedupeKey: n.dedupeKey });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  const courseId = queryId(req.query.id);
  try {
    const db = await getDb();
    if (req.method === 'GET') {
      const result = await reassignmentHistory(db, courseId);
      if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
      return res.json({ course: result.course, history: result.history });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await reassignCourse(db, {
      actor: { userId: req.user!.userId, email: req.user!.email, role: req.user!.role },
      courseId,
      instructorId: typeof body.instructorId === 'string' ? body.instructorId : '',
      reason: body.reason,
      notify: sendNotices,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
    return res.json({ success: true, courseId: result.courseId, instructorId: result.to, previousInstructorId: result.from });
  } catch (error: unknown) {
    console.error(JSON.stringify({ event: 'courseReassign', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(handler, ['admin', 'superadmin']);
