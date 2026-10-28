/**
 * GET /api/verify-payment/:reference?courseId=
 * Re-checks a full-course checkout for the signed-in student. Same rules as POST /api/courses/:id/pay.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { respondWithCourseConfirmation } from '@/lib/payment-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  return respondWithCourseConfirmation(req, res, {
    tag: 'verify-payment',
    reference: req.query.reference,
    expectedCourseId: req.query.courseId,
  });
}

export default withAuth(handler);
