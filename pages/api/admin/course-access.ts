/**
 * Super Admin course access (lib/course-access-admin.js, Phase 6).
 *
 * GET  /api/admin/course-access?email=<address> | ?userId=<id>   one student's enrollments and
 *      course entitlements
 * POST /api/admin/course-access  { action: 'grant' | 'revoke', userId, courseId, reason }
 *      grant: complimentary full-course access plus an active enrollment
 *      revoke: ends a complimentary or manual grant (paid access ends only through a refund)
 * Every change needs a reason and is written to the admin audit log.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { grantCourseAccess, revokeCourseGrant, studentAccessOverview } from '@/lib/course-access-admin';
import { firstQueryValues, superAdminOnly, withinLedgerLimit } from '@/lib/admin-ledger-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (!superAdminOnly(req, res)) return;
  try {
    const db = await getDb();
    if (req.method === 'GET') {
      const query = firstQueryValues(req.query);
      const result = await studentAccessOverview(db, { userId: query.userId, email: query.email });
      if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
      return res.status(200).json({ student: result.student, courses: result.courses });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!(await withinLedgerLimit('write', req, res))) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const input = {
      actor: { userId: req.user!.userId, email: req.user!.email },
      userId: typeof body.userId === 'string' ? body.userId : '',
      courseId: typeof body.courseId === 'string' ? body.courseId : '',
      reason: body.reason,
    };
    let result;
    if (body.action === 'grant') result = await grantCourseAccess(db, input);
    else if (body.action === 'revoke') result = await revokeCourseGrant(db, input);
    else return res.status(400).json({ error: 'Choose grant or revoke.', code: 'invalid_action' });
    if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
    console.log(JSON.stringify({ event: 'course_access', action: result.code }));
    return res.status(200).json({ code: result.code });
  } catch {
    return res.status(500).json(unexpectedBody('admin course access'));
  }
}

export default withAuth(handler, ['superadmin']);
