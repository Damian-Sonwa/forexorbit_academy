/**
 * POST /api/payments/paystack/verify
 * Verifies Paystack transaction and records lesson access + payment history.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { paystackVerifyTransaction } from '@/lib/paystack-server';
import {
  getLessonPriceKobo,
  isStaffRole,
  LESSON_PURCHASES_COLLECTION,
  PAYSTACK_INTENTS_COLLECTION,
  PAYSTACK_PAYMENTS_COLLECTION,
  sortLessonsByOrder,
  hasLessonPurchase,
} from '@/lib/lesson-monetization';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isStaffRole(req.user!.role)) {
    return res.status(400).json({ error: 'Invalid for staff' });
  }

  try {
    const { reference, lessonId, courseId } = req.body as {
      reference?: string;
      lessonId?: string;
      courseId?: string;
    };

    if (!reference || typeof reference !== 'string') {
      return res.status(400).json({ error: 'reference is required' });
    }
    if (!lessonId || !courseId) {
      return res.status(400).json({ error: 'lessonId and courseId are required' });
    }

    const db = await getDb();
    const intents = db.collection(PAYSTACK_INTENTS_COLLECTION);

    const intent = await intents.findOne({
      reference,
      userId: req.user!.userId,
      lessonId,
      courseId,
    });

    if (!intent) {
      return res.status(400).json({ error: 'Unknown or expired payment session. Start checkout again.' });
    }

    if (new Date(intent.expiresAt as Date) < new Date()) {
      await intents.deleteOne({ _id: intent._id });
      return res.status(400).json({ error: 'Payment session expired. Try again.' });
    }

    const expectedKobo = getLessonPriceKobo();
    if (Number(intent.amountKobo) !== expectedKobo) {
      return res.status(400).json({ error: 'Amount mismatch' });
    }

    const verify = await paystackVerifyTransaction(reference);
    if (!verify.status || !verify.data) {
      return res.status(400).json({ error: verify.message || 'Verification failed' });
    }

    const d = verify.data;
    if (d.status !== 'success') {
      return res.status(400).json({ error: 'Payment was not successful', paystackStatus: d.status });
    }

    if (d.amount !== expectedKobo) {
      return res.status(400).json({ error: 'Paid amount does not match lesson price' });
    }

    const meta = (d.metadata || {}) as Record<string, string>;
    if (meta.lessonId !== undefined && String(meta.lessonId) !== lessonId) {
      return res.status(400).json({ error: 'Metadata mismatch (lesson)' });
    }
    if (meta.courseId !== undefined && String(meta.courseId) !== courseId) {
      return res.status(400).json({ error: 'Metadata mismatch (course)' });
    }

    const lessons = db.collection('lessons');
    let lessonOid: ObjectId;
    try {
      lessonOid = new ObjectId(lessonId);
    } catch {
      return res.status(400).json({ error: 'Invalid lessonId' });
    }
    const lesson = await lessons.findOne({ _id: lessonOid });
    if (!lesson || String(lesson.courseId) !== courseId) {
      return res.status(400).json({ error: 'Invalid lesson' });
    }

    const courseLessons = await lessons.find({ courseId }).toArray();
    const sorted = sortLessonsByOrder(courseLessons as { _id: ObjectId; order?: number }[]);
    if (sorted[0]?._id.toString() === lessonId) {
      return res.status(400).json({ error: 'Cannot purchase free first lesson' });
    }

    const already = await hasLessonPurchase(db, req.user!.userId, lessonId);
    if (!already) {
      await db.collection(LESSON_PURCHASES_COLLECTION).insertOne({
        userId: req.user!.userId,
        lessonId,
        courseId,
        paystackReference: reference,
        amountKobo: d.amount,
        currency: d.currency || intent.currency || 'NGN',
        verifiedAt: new Date(),
        createdAt: new Date(),
      });
    }

    await db.collection(PAYSTACK_PAYMENTS_COLLECTION).insertOne({
      userId: req.user!.userId,
      lessonId,
      courseId,
      reference,
      status: d.status,
      amountKobo: d.amount,
      currency: d.currency,
      paystackCustomerEmail: d.customer?.email,
      createdAt: new Date(),
    });

    await intents.deleteOne({ _id: intent._id });

    return res.status(200).json({
      success: true,
      unlocked: true,
      reference,
    });
  } catch (e) {
    console.error('[paystack verify]', e);
    const msg = e instanceof Error ? e.message : 'Verification failed';
    return res.status(500).json({ error: msg });
  }
}

export default withAuth(handler);
