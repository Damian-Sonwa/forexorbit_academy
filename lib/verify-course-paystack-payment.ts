/**
 * Shared Paystack course checkout: verify transaction and grant userCourseAccess.
 * Used by POST /api/payments/paystack/verify (course) and POST /api/courses/:id/pay.
 */

import type { Db } from 'mongodb';
import { paystackVerifyTransaction } from '@/lib/paystack-server';
import {
  getCoursePriceKobo,
  PAYSTACK_INTENTS_COLLECTION,
  PAYSTACK_PAYMENTS_COLLECTION,
  USER_COURSE_ACCESS_COLLECTION,
} from '@/lib/lesson-monetization';

export type VerifyCoursePaymentResult =
  | { ok: true; reference: string; courseId: string; message: string }
  | { ok: false; status: number; message: string };

export async function verifyCoursePaymentAndUnlock(
  db: Db,
  params: { userId: string; courseId: string; reference: string }
): Promise<VerifyCoursePaymentResult> {
  const { userId, courseId, reference } = params;
  const intents = db.collection(PAYSTACK_INTENTS_COLLECTION);

  const intent = await intents.findOne({ reference, userId });
  if (!intent) {
    return { ok: false, status: 400, message: 'Unknown or expired payment session. Start checkout again.' };
  }
  if (new Date(intent.expiresAt as Date) < new Date()) {
    await intents.deleteOne({ _id: intent._id });
    return { ok: false, status: 400, message: 'Payment session expired. Try again.' };
  }
  if (intent.kind !== 'course') {
    return { ok: false, status: 400, message: 'This reference is not a course checkout session' };
  }
  if (String(intent.courseId) !== courseId) {
    return { ok: false, status: 400, message: 'courseId does not match payment session' };
  }

  const expectedKobo = getCoursePriceKobo();
  if (Number(intent.amountKobo) !== expectedKobo) {
    return { ok: false, status: 400, message: 'Amount mismatch' };
  }

  const verify = await paystackVerifyTransaction(reference);
  if (!verify.status || !verify.data) {
    console.error('[verifyCoursePaymentAndUnlock] Paystack API error:', verify);
    return {
      ok: false,
      status: 400,
      message: 'Payment could not be verified. Try again or contact support with your reference.',
    };
  }

  const d = verify.data;
  if (d.status !== 'success') {
    return { ok: false, status: 400, message: 'Payment was not successful. Please try again or use another method.' };
  }
  if (d.amount !== expectedKobo) {
    return { ok: false, status: 400, message: 'Paid amount does not match course price' };
  }

  const meta = (d.metadata || {}) as Record<string, string>;
  if (meta.courseId !== undefined && String(meta.courseId) !== courseId) {
    return { ok: false, status: 400, message: 'Metadata mismatch (course)' };
  }

  const now = new Date();
  await db.collection(USER_COURSE_ACCESS_COLLECTION).updateOne(
    { userId, courseId },
    {
      $set: {
        userId,
        courseId,
        paid: true,
        unlockedAt: now,
        paystackReference: reference,
        amountKobo: d.amount,
        currency: d.currency || (intent.currency as string) || 'NGN',
        verifiedAt: now,
        source: 'paystack-course',
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  await db.collection(PAYSTACK_PAYMENTS_COLLECTION).insertOne({
    userId,
    courseId,
    reference,
    kind: 'course',
    status: d.status,
    amountKobo: d.amount,
    currency: d.currency,
    paystackCustomerEmail: d.customer?.email,
    createdAt: new Date(),
  });

  await intents.deleteOne({ _id: intent._id });

  return {
    ok: true,
    reference,
    courseId,
    message: 'Payment successful. This course is now fully unlocked.',
  };
}
