/**
 * POST /api/courses/:courseId/pay
 * Confirms a Paystack course checkout: verifies payment and unlocks the full course for the authenticated user.
 *
 * Body: { reference: string } (Paystack transaction reference).
 * userId is taken only from the JWT — any userId in the body is ignored.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { isStaffRole, isPaystackConfigured } from '@/lib/lesson-monetization';
import { verifyCoursePaymentAndUnlock } from '@/lib/verify-course-paystack-payment';

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
    const { id: courseId } = req.query;
    if (!courseId || typeof courseId !== 'string') {
      return res.status(400).json({ message: 'courseId required' });
    }

    const body = req.body as { reference?: string; userId?: string };
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!reference) {
      return res.status(400).json({ message: 'reference is required' });
    }

    let oid: ObjectId;
    try {
      oid = new ObjectId(courseId);
    } catch {
      return res.status(400).json({ message: 'Invalid courseId' });
    }

    const db = await getDb();
    const course = await db.collection('courses').findOne({ _id: oid });
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const result = await verifyCoursePaymentAndUnlock(db, {
      userId: req.user!.userId,
      courseId,
      reference,
    });

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    return res.status(200).json({
      success: true,
      access: true,
      unlocked: true,
      unlockCourse: true,
      message: result.message,
      reference: result.reference,
      courseId: result.courseId,
    });
  } catch (e) {
    console.error('[courses/:id/pay]', e);
    return res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(handler);
