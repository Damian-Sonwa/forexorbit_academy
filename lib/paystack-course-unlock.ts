/**
 * Verify Paystack transactions and unlock courses (no client-side secret).
 * Used by GET /api/verify-payment/:reference, webhooks, and legacy intent flow.
 */

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { paystackVerifyTransaction, type PaystackVerifyData } from '@/lib/paystack-server';
import {
  COURSE_PURCHASES_COLLECTION,
  getCoursePriceKobo,
  getPaystackCurrency,
  hasPaidForCourse,
  isStaffRole,
  PAYSTACK_INTENTS_COLLECTION,
  PAYSTACK_PAYMENTS_COLLECTION,
  USER_COURSE_ACCESS_COLLECTION,
} from '@/lib/lesson-monetization';

export type UnlockSource = 'verify-api' | 'webhook';

function normEmail(e: string | undefined | null): string {
  return typeof e === 'string' ? e.trim().toLowerCase() : '';
}

function log(prefix: string, msg: string, extra?: Record<string, unknown>) {
  const line = `[paystack-unlock] ${prefix} ${msg}`;
  if (extra) console.log(line, extra);
  else console.log(line);
}

export type VerifyAndUnlockResult =
  | { ok: true; verified: true; courseId: string; reference: string; alreadyHadAccess?: boolean; alreadyProcessed?: boolean }
  | { ok: false; status: number; message: string };

/**
 * After Paystack reports success, persist access + purchase rows (idempotent by reference).
 */
export async function persistCourseUnlockFromPaystackData(
  db: Db,
  params: {
    userId: string;
    courseId: string;
    reference: string;
    amountKobo: number;
    currency: string;
    paystackCustomerEmail?: string;
    source: UnlockSource;
  }
): Promise<{ ok: true; alreadyHadAccess: boolean; duplicateReference: boolean } | { ok: false; message: string }> {
  const { userId, courseId, reference, amountKobo, currency, paystackCustomerEmail, source } = params;
  const payments = db.collection(PAYSTACK_PAYMENTS_COLLECTION);
  const existing = await payments.findOne({ reference });
  if (existing) {
    if (String(existing.userId) === userId && String(existing.courseId) === courseId) {
      log('persist', 'duplicate reference — same user/course, idempotent success', { reference });
      const had = await hasPaidForCourse(db, userId, courseId);
      return { ok: true, alreadyHadAccess: had, duplicateReference: true };
    }
    log('persist', 'FAILED duplicate reference mismatch', { reference, existingUser: existing.userId });
    return { ok: false, message: 'This payment reference is already registered to another account.' };
  }

  if (await hasPaidForCourse(db, userId, courseId)) {
    log('persist', 'user already has course access — recording payment only', { userId, courseId });
    await payments.insertOne({
      userId,
      courseId,
      reference,
      kind: 'course',
      status: 'success',
      amountKobo,
      currency,
      paystackCustomerEmail,
      source,
      createdAt: new Date(),
    });
    await db.collection(COURSE_PURCHASES_COLLECTION).updateOne(
      { userId, courseId },
      {
        $set: {
          userId,
          courseId,
          paymentReference: reference,
          status: 'paid',
          amountKobo,
          currency,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    return { ok: true, alreadyHadAccess: true, duplicateReference: false };
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
        amountKobo,
        currency,
        verifiedAt: now,
        source: `paystack-${source}`,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  await payments.insertOne({
    userId,
    courseId,
    reference,
    kind: 'course',
    status: 'success',
    amountKobo,
    currency,
    paystackCustomerEmail,
    source,
    createdAt: now,
  });

  await db.collection(COURSE_PURCHASES_COLLECTION).updateOne(
    { userId, courseId },
    {
      $set: {
        userId,
        courseId,
        paymentReference: reference,
        status: 'paid',
        amountKobo,
        currency,
        verifiedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  await db.collection(PAYSTACK_INTENTS_COLLECTION).deleteMany({ reference, userId, courseId });

  log('persist', 'course unlocked', { userId, courseId, reference, source });
  return { ok: true, alreadyHadAccess: false, duplicateReference: false };
}

function validateTransactionData(
  d: PaystackVerifyData,
  expectedCourseId: string
): { ok: true; courseId: string } | { ok: false; message: string } {
  if (d.status !== 'success') {
    return { ok: false, message: 'Payment was not successful' };
  }
  const meta = (d.metadata || {}) as Record<string, string | undefined>;
  const courseId = meta.courseId != null ? String(meta.courseId).trim() : '';
  const unlockCourse = meta.unlockCourse === 'true' || meta.unlockCourse === '1';
  if (!courseId) {
    return { ok: false, message: 'Missing courseId in payment metadata' };
  }
  if (!unlockCourse) {
    return { ok: false, message: 'Payment metadata does not mark a course unlock' };
  }
  if (courseId !== expectedCourseId) {
    return { ok: false, message: 'courseId in metadata does not match' };
  }
  const expectedKobo = getCoursePriceKobo();
  if (d.amount !== expectedKobo) {
    log('validate', 'amount mismatch', { got: d.amount, expected: expectedKobo });
    return { ok: false, message: 'Paid amount does not match course price' };
  }
  return { ok: true, courseId };
}

/**
 * GET /api/verify-payment/:reference — authenticated user; email must match Paystack customer.
 */
export async function verifyPaymentReferenceForUser(
  db: Db,
  reference: string,
  authUser: { userId: string; email: string; role: string }
): Promise<VerifyAndUnlockResult> {
  const ref = reference.trim();
  if (!ref) {
    return { ok: false, status: 400, message: 'reference is required' };
  }

  if (isStaffRole(authUser.role)) {
    return { ok: false, status: 400, message: 'Staff accounts do not purchase courses' };
  }

  let verify;
  try {
    verify = await paystackVerifyTransaction(ref);
  } catch (e) {
    console.error('[verifyPaymentReferenceForUser] Paystack API error', e);
    return { ok: false, status: 502, message: 'Could not reach payment provider' };
  }

  log('verify', 'Paystack verify response', { reference: ref, status: verify.status, message: verify.message });

  if (!verify.status || !verify.data) {
    log('verify', 'FAILED verification', { reference: ref, message: verify.message });
    return { ok: false, status: 400, message: verify.message || 'Verification failed' };
  }

  const d = verify.data;
  const payEmail = normEmail(d.customer?.email);
  const userEmail = normEmail(authUser.email);
  if (!payEmail || payEmail !== userEmail) {
    log('verify', 'FAILED email mismatch', { payEmail, userEmail });
    return {
      ok: false,
      status: 403,
      message: 'Payment email does not match your account. Use the same email you paid with, or contact support.',
    };
  }

  const meta = (d.metadata || {}) as Record<string, string | undefined>;
  const courseIdFromMeta = meta.courseId != null ? String(meta.courseId).trim() : '';
  if (!courseIdFromMeta) {
    return { ok: false, status: 400, message: 'Missing courseId in payment metadata' };
  }

  const validated = validateTransactionData(d, courseIdFromMeta);
  if (!validated.ok) {
    return { ok: false, status: 400, message: validated.message };
  }

  let oid: ObjectId;
  try {
    oid = new ObjectId(courseIdFromMeta);
  } catch {
    return { ok: false, status: 400, message: 'Invalid courseId in metadata' };
  }

  const course = await db.collection('courses').findOne({ _id: oid });
  if (!course) {
    return { ok: false, status: 404, message: 'Course not found' };
  }

  const persist = await persistCourseUnlockFromPaystackData(db, {
    userId: authUser.userId,
    courseId: courseIdFromMeta,
    reference: d.reference || ref,
    amountKobo: d.amount,
    currency: d.currency || getPaystackCurrency(),
    paystackCustomerEmail: d.customer?.email,
    source: 'verify-api',
  });

  if (!persist.ok) {
    return { ok: false, status: 409, message: persist.message };
  }

  return {
    ok: true,
    verified: true,
    courseId: courseIdFromMeta,
    reference: d.reference || ref,
    alreadyHadAccess: persist.alreadyHadAccess,
    alreadyProcessed: persist.duplicateReference,
  };
}

/**
 * Webhook: find user by email and unlock course from verified payload (caller verifies signature).
 */
export async function unlockCourseFromWebhookPayload(
  db: Db,
  data: PaystackVerifyData
): Promise<{ ok: true } | { ok: false; message: string }> {
  const d = data;
  if (d.status && d.status !== 'success') {
    return { ok: false, message: 'Transaction not successful' };
  }

  const meta = (d.metadata || {}) as Record<string, string | undefined>;
  const courseId = meta.courseId != null ? String(meta.courseId).trim() : '';
  const unlockCourse = meta.unlockCourse === 'true' || meta.unlockCourse === '1';
  if (!courseId || !unlockCourse) {
    log('webhook', 'skip — not a course unlock', { reference: d.reference });
    return { ok: false, message: 'Not a course unlock payment' };
  }

  const expectedKobo = getCoursePriceKobo();
  if (d.amount !== expectedKobo) {
    log('webhook', 'FAILED amount mismatch', { amount: d.amount, expected: expectedKobo });
    return { ok: false, message: 'Amount mismatch' };
  }

  let oid: ObjectId;
  try {
    oid = new ObjectId(courseId);
  } catch {
    return { ok: false, message: 'Invalid courseId' };
  }

  const course = await db.collection('courses').findOne({ _id: oid });
  if (!course) {
    return { ok: false, message: 'Course not found' };
  }

  const email = normEmail(d.customer?.email);
  if (!email) {
    log('webhook', 'FAILED no customer email', { reference: d.reference });
    return { ok: false, message: 'No customer email on transaction' };
  }

  const user = await db.collection('users').findOne({ email });
  if (!user || !user._id) {
    log('webhook', 'FAILED user not found for email', { email });
    return { ok: false, message: 'No user account for this email' };
  }

  const userId = String(user._id);
  const payRef = d.reference?.trim() || '';
  if (!payRef) {
    log('webhook', 'FAILED missing reference', {});
    return { ok: false, message: 'Missing transaction reference' };
  }

  const persist = await persistCourseUnlockFromPaystackData(db, {
    userId,
    courseId,
    reference: payRef,
    amountKobo: d.amount,
    currency: d.currency || getPaystackCurrency(),
    paystackCustomerEmail: d.customer?.email,
    source: 'webhook',
  });

  if (!persist.ok) {
    return { ok: false, message: persist.message };
  }

  return { ok: true };
}
