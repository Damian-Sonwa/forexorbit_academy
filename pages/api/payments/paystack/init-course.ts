/**
 * POST /api/payments/paystack/init-course
 * Creates the server-side intent for a one-time full-course purchase.
 * The client must use the returned reference, amount, and currency unchanged.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createCourseIntent, presentConfirmResult } from '@/lib/course-payment';
import {
  logPayment,
  lookupPaystackTransaction,
  newSupportId,
  paymentsAllowed,
  studentOnly,
  withinRateLimit,
} from '@/lib/payment-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (!paymentsAllowed(res) || !studentOnly(req, res) || !(await withinRateLimit('init', req, res))) return;

  const supportId = newSupportId();
  const { courseId } = (req.body || {}) as { courseId?: unknown };
  if (typeof courseId !== 'string' || !ObjectId.isValid(courseId)) {
    return res.status(400).json({ success: false, code: 'invalid_course', message: 'A valid courseId is required' });
  }

  try {
    const db = await getDb();
    const course = await db.collection('courses').findOne({ _id: new ObjectId(courseId) }, { projection: { _id: 1 } });
    if (!course) {
      return res.status(404).json({ success: false, code: 'course_not_found', message: 'Course not found' });
    }

    const result = await createCourseIntent(db, {
      userId: req.user!.userId,
      courseId,
      fetchTransaction: lookupPaystackTransaction,
    });

    if (!result.ok) {
      logPayment('init-course', { supportId, code: result.code });
      const { status, body } = presentConfirmResult(result, supportId);
      return res.status(status).json(body);
    }
    if (result.alreadyOwned) {
      logPayment('init-course', { supportId, code: 'already_owned' });
      return res.status(200).json({ alreadyOwned: true, reference: null, courseId, message: 'You already have full access to this course.' });
    }

    logPayment('init-course', { supportId, reference: result.reference, code: 'intent_created' });
    return res.status(200).json({
      alreadyOwned: false,
      reference: result.reference,
      amountKobo: result.amountKobo,
      currency: result.currency,
      email: req.user!.email,
      userId: req.user!.userId,
      courseId,
      message: 'Checkout ready. Complete payment in the Paystack window.',
    });
  } catch {
    logPayment('init-course', { supportId, code: 'internal_error' });
    return res.status(503).json({ success: false, code: 'internal_error', retryable: true, message: 'Could not start checkout. Try again shortly.', supportId });
  }
}

export default withAuth(handler);
