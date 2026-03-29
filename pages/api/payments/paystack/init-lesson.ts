/**
 * POST /api/payments/paystack/init-lesson
 * Creates a Paystack payment intent (reference) for unlocking a paid lesson.
 */

import type { NextApiResponse } from 'next';
import crypto from 'crypto';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import {
  getLessonPriceKobo,
  getPaystackCurrency,
  isPaystackConfigured,
  isStaffRole,
  PAYSTACK_INTENTS_COLLECTION,
  sortLessonsByOrder,
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
    return res.status(400).json({ message: 'Staff accounts do not need to purchase lessons' });
  }

  try {
    const { lessonId } = req.body as { lessonId?: string };
    if (!lessonId || typeof lessonId !== 'string') {
      return res.status(400).json({ message: 'lessonId is required' });
    }

    let oid: ObjectId;
    try {
      oid = new ObjectId(lessonId);
    } catch {
      return res.status(400).json({ message: 'Invalid lessonId' });
    }

    const db = await getDb();
    const lessons = db.collection('lessons');
    const lesson = await lessons.findOne({ _id: oid });
    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found' });
    }

    const courseId = String(lesson.courseId);
    const courseLessons = await lessons.find({ courseId }).toArray();
    const sorted = sortLessonsByOrder(courseLessons as { _id: ObjectId; order?: number; isFirstLesson?: boolean }[]);
    const firstId = sorted[0]?._id.toString();
    if (firstId === lessonId || lesson.isFirstLesson === true) {
      return res.status(400).json({ message: 'The first lesson in each course is free' });
    }
    if (lesson.isDemo === true) {
      return res.status(400).json({ message: 'Demo lessons are free' });
    }

    const coursePaid = await hasPaidForCourse(db, req.user!.userId, courseId);
    if (coursePaid) {
      return res.status(200).json({
        message: 'You already have full access to this course.',
        alreadyOwned: true,
        reference: null,
        amountKobo: getLessonPriceKobo(),
        currency: getPaystackCurrency(),
        email: req.user!.email,
        userId: req.user!.userId,
        lessonId,
        courseId,
      });
    }

    const reference = `fo_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const amountKobo = getLessonPriceKobo();
    const currency = getPaystackCurrency();

    await db.collection(PAYSTACK_INTENTS_COLLECTION).insertOne({
      reference,
      userId: req.user!.userId,
      email: req.user!.email,
      lessonId,
      courseId,
      kind: 'lesson',
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
      lessonId,
      courseId,
    });
  } catch (e) {
    console.error('[init-lesson]', e);
    return res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(handler);
