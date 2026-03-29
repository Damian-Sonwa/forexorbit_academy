/**
 * POST /api/verify-payment/manual
 * Body: { reference: string } — same verification as GET /api/verify-payment/:reference (for "Fix payment" UI).
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { isPaystackConfigured } from '@/lib/lesson-monetization';
import { verifyPaymentReferenceForUser } from '@/lib/paystack-course-unlock';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!isPaystackConfigured()) {
    return res.status(503).json({ message: 'Payments are not configured' });
  }

  const body = req.body as { reference?: string };
  const ref = typeof body.reference === 'string' ? body.reference.trim() : '';
  if (!ref) {
    return res.status(400).json({ message: 'reference is required' });
  }

  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const db = await getDb();
    const result = await verifyPaymentReferenceForUser(db, ref, {
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
    });

    if (!result.ok) {
      console.error('[verify-payment/manual] FAILED', { reference: ref, message: result.message });
      return res.status(result.status).json({ verified: false, message: result.message });
    }

    return res.status(200).json({
      verified: true,
      success: true,
      courseId: result.courseId,
      reference: result.reference,
      alreadyHadAccess: result.alreadyHadAccess,
      alreadyProcessed: result.alreadyProcessed,
      message: 'Payment verified. Course unlocked.',
    });
  } catch (e) {
    console.error('[verify-payment/manual] error', e);
    return res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(handler);
