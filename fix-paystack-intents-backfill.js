/**
 * One-off: clean bad rows in paystackPaymentIntents (wrong/missing metadata, string IDs),
 * then insert a correct intent + paystackPayments row for manual backfill.
 *
 * Does NOT change application code — run locally or in CI with DB access.
 *
 * Required env:
 *   MONGO_URI or MONGODB_URI
 *   BACKFILL_USER_ID, BACKFILL_COURSE_ID, BACKFILL_REFERENCE
 *
 * Optional: PAYSTACK_COURSE_PRICE_KOBO, PAYSTACK_CURRENCY, DRY_RUN=1
 */

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

const INTENTS = 'paystackPaymentIntents';
const PAYMENTS = 'paystackPayments';

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

const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const CONFIG = {
  userId: (process.env.BACKFILL_USER_ID || '').trim(),
  courseId: (process.env.BACKFILL_COURSE_ID || '').trim(),
  reference: (process.env.BACKFILL_REFERENCE || '').trim(),
};

async function main() {
  const uri = (process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) {
    console.error('Missing MONGO_URI or MONGODB_URI');
    process.exit(1);
  }
  if (!CONFIG.userId || !CONFIG.courseId || !CONFIG.reference) {
    console.error('Set BACKFILL_USER_ID, BACKFILL_COURSE_ID, and BACKFILL_REFERENCE');
    process.exit(1);
  }

  let userOid;
  let courseOid;
  try {
    userOid = new ObjectId(CONFIG.userId);
    courseOid = new ObjectId(CONFIG.courseId);
  } catch (e) {
    console.error('Invalid BACKFILL_USER_ID or BACKFILL_COURSE_ID:', e.message);
    process.exit(1);
  }

  const userIdStr = String(userOid);
  const courseIdStr = String(courseOid);
  const amountKobo = getCoursePriceKobo();
  const currency = getCurrency();
  const now = new Date();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const source = 'paystack-backfill';

  const metaObjectIds = {
    userId: userOid,
    courseId: courseOid,
  };

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20_000 });

  try {
    await client.connect();
    const db = client.db();

    const users = db.collection('users');
    const user = await users.findOne({ _id: userOid });
    if (!user) {
      console.error('User not found:', userIdStr);
      process.exit(1);
    }
    const email =
      typeof user.email === 'string' && user.email.trim()
        ? user.email.trim().toLowerCase()
        : null;
    if (!email) {
      console.error('User has no email — verify endpoints may fail:', userIdStr);
      process.exit(1);
    }

    const courses = db.collection('courses');
    const course = await courses.findOne({ _id: courseOid });
    if (!course) {
      console.error('Course not found:', courseIdStr);
      process.exit(1);
    }

    const intents = db.collection(INTENTS);
    const payments = db.collection(PAYMENTS);

    // --- Delete incorrect backfill / bad metadata (do not touch normal intents without metadata) ---
    // Remove prior manual backfill intents; drop any intent whose metadata IDs were stored as strings.
    const deleteFilter = {
      $or: [
        { source: 'paystack-backfill' },
        { 'metadata.userId': { $type: 'string' } },
        { 'metadata.courseId': { $type: 'string' } },
      ],
    };

    const badCount = await intents.countDocuments(deleteFilter);
    console.log(`[intents] matched for delete: ${badCount}`, DRY ? '(dry run)' : '');

    if (!DRY && badCount > 0) {
      const del = await intents.deleteMany(deleteFilter);
      console.log(`[intents] deleted: ${del.deletedCount}`);
    }

    // Remove any stale payment row for this reference so we can insert a clean one
    const payDel = await payments.countDocuments({ reference: CONFIG.reference });
    console.log(`[payments] existing rows for reference: ${payDel}`, DRY ? '(dry run)' : '');
    if (!DRY && payDel > 0) {
      const r = await payments.deleteMany({ reference: CONFIG.reference });
      console.log(`[payments] deleted for reference: ${r.deletedCount}`);
    }

    if (DRY) {
      console.log('DRY_RUN=1 — no inserts performed.');
      await client.close();
      return;
    }

    // --- Intent: verify path expects reference + userId + courseId strings; metadata uses ObjectIds ---
    await intents.insertOne({
      reference: CONFIG.reference,
      userId: userIdStr,
      courseId: courseIdStr,
      email,
      kind: 'course',
      amountKobo,
      currency,
      status: 'success',
      source,
      metadata: metaObjectIds,
      createdAt: now,
      expiresAt,
    });

    await payments.insertOne({
      userId: userIdStr,
      courseId: courseIdStr,
      reference: CONFIG.reference,
      kind: 'course',
      status: 'success',
      amountKobo,
      currency,
      paystackCustomerEmail: email,
      source,
      metadata: metaObjectIds,
      createdAt: now,
    });

    console.log('OK:', {
      reference: CONFIG.reference,
      userId: userIdStr,
      courseId: courseIdStr,
      email,
      amountKobo,
      currency,
      metadata: { userId: 'ObjectId', courseId: 'ObjectId' },
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
