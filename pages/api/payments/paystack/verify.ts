/**
 * POST /api/payments/paystack/verify
 * Body: { reference, courseId? }. Confirms a full-course checkout intent.
 * Lesson intents from the retired per-lesson checkout return 410 and grant nothing.
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
    tag: 'paystack-verify',
    reference: body.reference,
    expectedCourseId: body.courseId,
  });
}

export default withAuth(handler);
