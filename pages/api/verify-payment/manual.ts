/**
 * POST /api/verify-payment/manual
 * Body: { reference, courseId? }. Backs the "Paid but still locked?" box on the course page.
 * Same rules as POST /api/courses/:id/pay; references without a checkout intent go to support review.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { respondWithCourseConfirmation } from '@/lib/payment-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const body = (req.body || {}) as { reference?: unknown; courseId?: unknown };
  return respondWithCourseConfirmation(req, res, {
    tag: 'verify-payment-manual',
    reference: body.reference,
    expectedCourseId: body.courseId,
  });
}

export default withAuth(handler);
