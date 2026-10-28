/**
 * POST /api/courses/:courseId/pay
 * Body: { reference }. Confirms the signed-in student's full-course checkout intent.
 * The user comes from the session; any userId in the body is ignored.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { respondWithCourseConfirmation } from '@/lib/payment-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const { id: courseId } = req.query;
  if (typeof courseId !== 'string' || !courseId) {
    return res.status(400).json({ success: false, code: 'invalid_course', message: 'courseId required' });
  }
  const body = (req.body || {}) as { reference?: unknown };
  return respondWithCourseConfirmation(req, res, {
    tag: 'course-pay',
    reference: body.reference,
    expectedCourseId: courseId,
  });
}

export default withAuth(handler);
