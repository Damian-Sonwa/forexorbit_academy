/**
 * POST /api/payments/paystack/verify
 * Verifies Paystack transaction — course unlock (userCourseAccess) or legacy per-lesson unlock (userLessonAccess).
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { paystackVerifyTransaction } from '@/lib/paystack-server';
import {
  getLessonPriceKobo,
  isStaffRole,
  USER_ACCESS_COLLECTION,
  PAYSTACK_INTENTS_COLLECTION,
  PAYSTACK_PAYMENTS_COLLECTION,
  sortLessonsByOrder,
} from '@/lib/lesson-monetization';
import { verifyCoursePaymentAndUnlock } from '@/lib/verify-course-paystack-payment';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (isStaffRole(req.user!.role)) {
    return res.status(400).json({ message: 'Invalid for staff' });
  }

  try {
    const body = req.body as {
      reference?: string;
      lessonId?: string;
      courseId?: string;
      unlockCourse?: boolean;
    };
    const { reference, lessonId, courseId } = body;

    if (!reference || typeof reference !== 'string') {
      return res.status(400).json({ message: 'reference is required' });
    }
    if (!courseId || typeof courseId !== 'string') {
      return res.status(400).json({ message: 'courseId is required' });
    }

    const db = await getDb();
    const intents = db.collection(PAYSTACK_INTENTS_COLLECTION);

    const intent = await intents.findOne({
      reference,
      userId: req.user!.userId,
    });

    if (!intent) {
      return res.status(400).json({ message: 'Unknown or expired payment session. Start checkout again.' });
    }

    if (new Date(intent.expiresAt as Date) < new Date()) {
      await intents.deleteOne({ _id: intent._id });
      return res.status(400).json({ message: 'Payment session expired. Try again.' });
    }

    const isCourseIntent = intent.kind === 'course';

    if (isCourseIntent) {
      const courseResult = await verifyCoursePaymentAndUnlock(db, {
        userId: req.user!.userId,
        courseId,
        reference,
      });
      if (!courseResult.ok) {
        return res.status(courseResult.status).json({ message: courseResult.message });
      }
      return res.status(200).json({
        success: true,
        access: true,
        message: courseResult.message,
        unlocked: true,
        unlockCourse: true,
        reference: courseResult.reference,
        courseId: courseResult.courseId,
      });
    }

    // --- Legacy per-lesson intent ---
    if (!lessonId || typeof lessonId !== 'string') {
      return res.status(400).json({ message: 'lessonId is required for this payment session' });
    }

    if (String(intent.lessonId) !== lessonId || String(intent.courseId) !== courseId) {
      return res.status(400).json({ message: 'Session does not match lesson or course' });
    }

    const expectedKobo = getLessonPriceKobo();
    if (Number(intent.amountKobo) !== expectedKobo) {
      return res.status(400).json({ message: 'Amount mismatch' });
    }

    const verify = await paystackVerifyTransaction(reference);
    if (!verify.status || !verify.data) {
      console.error('[paystack verify] Paystack API error:', verify);
      return res.status(400).json({
        message: 'Payment could not be verified. Try again or contact support with your reference.',
      });
    }

    const d = verify.data;
    if (d.status !== 'success') {
      return res.status(400).json({ message: 'Payment was not successful. Please try again or use another method.' });
    }

    if (d.amount !== expectedKobo) {
      return res.status(400).json({ message: 'Paid amount does not match lesson price' });
    }

    const meta = (d.metadata || {}) as Record<string, string>;
    if (meta.userId !== undefined && String(meta.userId) !== req.user!.userId) {
      return res.status(400).json({ message: 'Metadata mismatch (user)' });
    }
    if (meta.lessonId !== undefined && String(meta.lessonId) !== lessonId) {
      return res.status(400).json({ message: 'Metadata mismatch (lesson)' });
    }
    if (meta.courseId !== undefined && String(meta.courseId) !== courseId) {
      return res.status(400).json({ message: 'Metadata mismatch (course)' });
    }

    const lessons = db.collection('lessons');
    let lessonOid: ObjectId;
    try {
      lessonOid = new ObjectId(lessonId);
    } catch {
      return res.status(400).json({ message: 'Invalid lessonId' });
    }
    const lesson = await lessons.findOne({ _id: lessonOid });
    if (!lesson || String(lesson.courseId) !== courseId) {
      return res.status(400).json({ message: 'Invalid lesson' });
    }

    const courseLessons = await lessons.find({ courseId }).toArray();
    const sorted = sortLessonsByOrder(courseLessons as { _id: ObjectId; order?: number; isFirstLesson?: boolean }[]);
    const isComputedFirst = sorted[0]?._id.toString() === lessonId;
    if (isComputedFirst || lesson.isFirstLesson === true) {
      return res.status(400).json({ message: 'Cannot purchase free first lesson' });
    }
    if (lesson.isDemo === true) {
      return res.status(400).json({ message: 'Demo lessons are free' });
    }

    const now = new Date();
    await db.collection(USER_ACCESS_COLLECTION).updateOne(
      { userId: req.user!.userId, lessonId },
      {
        $set: {
          userId: req.user!.userId,
          lessonId,
          courseId,
          paid: true,
          unlockedAt: now,
          paystackReference: reference,
          amountKobo: d.amount,
          currency: d.currency || (intent.currency as string) || 'NGN',
          verifiedAt: now,
          source: 'paystack',
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    await db.collection(PAYSTACK_PAYMENTS_COLLECTION).insertOne({
      userId: req.user!.userId,
      lessonId,
      courseId,
      reference,
      kind: 'lesson',
      status: d.status,
      amountKobo: d.amount,
      currency: d.currency,
      paystackCustomerEmail: d.customer?.email,
      createdAt: new Date(),
    });

    await intents.deleteOne({ _id: intent._id });

    return res.status(200).json({
      success: true,
      access: true,
      message: 'Payment successful. This lesson is now unlocked.',
      unlocked: true,
      reference,
      lessonId,
      courseId,
    });
  } catch (e) {
    console.error('[paystack verify]', e);
    return res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(handler);
