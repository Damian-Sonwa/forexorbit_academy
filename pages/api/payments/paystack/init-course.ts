/**
 * POST /api/payments/paystack/init-course
 * Creates a Paystack intent to unlock all paid lessons in a course (one-time course payment).
 * Client should send Paystack metadata: { userId, courseId } (from this response).
 */

import type { NextApiResponse } from 'next';
import crypto from 'crypto';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import {
  getCoursePriceKobo,
  getPaystackCurrency,
  isPaystackConfigured,
  isStaffRole,
  PAYSTACK_INTENTS_COLLECTION,
  hasPaidForCourse,
} from '@/lib/lesson-monetization';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!isPaystackConfigured()) {
    return res.status(503).json({ message: 'Payments are not configured' });
  }

  if (isStaffRole(req.user!.role)) {
    return res.status(400).json({ message: 'Staff accounts do not need to purchase courses' });
  }

  try {
    const { courseId } = req.body as { courseId?: string };
    if (!courseId || typeof courseId !== 'string') {
      return res.status(400).json({ message: 'courseId is required' });
    }

    let oid: ObjectId;
    try {
      oid = new ObjectId(courseId);
    } catch {
      return res.status(400).json({ message: 'Invalid courseId' });
    }

    const db = await getDb();
    const courses = db.collection('courses');
    const course = await courses.findOne({ _id: oid });
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const paid = await hasPaidForCourse(db, req.user!.userId, courseId);
    if (paid) {
      return res.status(200).json({
        message: 'You already have full access to this course.',
        alreadyOwned: true,
        reference: null,
        amountKobo: getCoursePriceKobo(),
        currency: getPaystackCurrency(),
        email: req.user!.email,
        userId: req.user!.userId,
        courseId,
      });
    }

    const reference = `fo_c_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const amountKobo = getCoursePriceKobo();
    const currency = getPaystackCurrency();

    await db.collection(PAYSTACK_INTENTS_COLLECTION).insertOne({
      reference,
      userId: req.user!.userId,
      email: req.user!.email,
      courseId,
      kind: 'course',
      amountKobo,
      currency,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    return res.status(200).json({
      message: 'Checkout ready. Complete payment in the Paystack window.',
      reference,
      amountKobo,
      currency,
      email: req.user!.email,
      userId: req.user!.userId,
      courseId,
    });
  } catch (e) {
    console.error('[init-course]', e);
    return res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(handler);
