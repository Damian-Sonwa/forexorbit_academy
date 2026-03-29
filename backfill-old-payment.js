/**
 * One-off backfill: grant full-course access for an old Paystack payment that never got
 * metadata-based webhook/verify rows (manual ops only).
 *
 * This app uses the MongoDB driver + these collections (not Mongoose / no Purchase model):
 *   userCourseAccess, coursePurchases, paystackPayments
 *
 * Usage (from repo root):
 *   node backfill-old-payment.js
 *
 * Set env vars (or edit CONFIG below):
 *   MONGO_URI or MONGODB_URI  — required
 *   BACKFILL_USER_ID          — MongoDB ObjectId string for the user
 *   BACKFILL_COURSE_ID        — MongoDB ObjectId string for the course
 *   BACKFILL_REFERENCE        — Paystack reference (default below)
 *   PAYSTACK_COURSE_PRICE_KOBO, PAYSTACK_CURRENCY — optional, match production
 *
 * Example:
 *   BACKFILL_USER_ID=... BACKFILL_COURSE_ID=... node backfill-old-payment.js
 */

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

const COLLECTIONS = {
  userCourseAccess: 'userCourseAccess',
  coursePurchases: 'coursePurchases',
  paystackPayments: 'paystackPayments',
};

function getCoursePriceKobo() {
  const raw = process.env.PAYSTACK_COURSE_PRICE_KOBO?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 500000;
}

function getCurrency() {
  return (process.env.PAYSTACK_CURRENCY || 'NGN').toUpperCase();
}

const CONFIG = {
  userId: (process.env.BACKFILL_USER_ID || '').trim(),
  courseId: (process.env.BACKFILL_COURSE_ID || '').trim(),
  paymentReference: (
    process.env.BACKFILL_REFERENCE || 'fo_1774766686990_3r9gow7'
  ).trim(),
};

async function backfillOldPayment() {
  const uri = (process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) {
    console.error('Missing MONGO_URI or MONGODB_URI');
    process.exit(1);
  }
  if (!CONFIG.userId || !CONFIG.courseId) {
    console.error(
      'Set BACKFILL_USER_ID and BACKFILL_COURSE_ID (Mongo ObjectId strings), or edit CONFIG in this file.'
    );
    process.exit(1);
  }

  let userOid;
  let courseOid;
  try {
    userOid = new ObjectId(CONFIG.userId);
    courseOid = new ObjectId(CONFIG.courseId);
  } catch (e) {
    console.error('Invalid BACKFILL_USER_ID or BACKFILL_COURSE_ID (must be valid ObjectId strings):', e.message);
    process.exit(1);
  }

  const amountKobo = getCoursePriceKobo();
  const currency = getCurrency();
  const reference = CONFIG.paymentReference;
  const userId = String(userOid);
  const courseId = String(courseOid);
  const now = new Date();
  const source = 'paystack-backfill';

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15_000,
  });

  try {
    await client.connect();
    const db = client.db();

    const users = db.collection('users');
    const courses = db.collection('courses');
    const user = await users.findOne({ _id: userOid });
    if (!user) {
      console.error('User not found for userId:', userId);
      process.exit(1);
    }
    const course = await courses.findOne({ _id: courseOid });
    if (!course) {
      console.error('Course not found for courseId:', courseId);
      process.exit(1);
    }

    const payments = db.collection(COLLECTIONS.paystackPayments);
    const existing = await payments.findOne({ reference });
    if (existing) {
      if (String(existing.userId) === userId && String(existing.courseId) === courseId) {
        console.log('Reference already recorded for this user/course — idempotent OK:', reference);
        await client.close();
        return;
      }
      console.error('Reference already used by another user/course:', reference, existing);
      process.exit(1);
    }

    await db.collection(COLLECTIONS.userCourseAccess).updateOne(
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
      paystackCustomerEmail: typeof user.email === 'string' ? user.email : undefined,
      source: source,
      createdAt: now,
    });

    await db.collection(COLLECTIONS.coursePurchases).updateOne(
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

    console.log('Backfill OK:', {
      userId,
      courseId,
      paymentReference: reference,
      amountKobo,
      currency,
    });
  } catch (e) {
    console.error('Backfill failed:', e);
    process.exit(1);
  } finally {
    await client.close();
  }
}

backfillOldPayment();
