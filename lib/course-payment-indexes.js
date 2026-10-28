/**
 * Unique indexes for the course payment collections (D2/D3).
 * See docs/audits/course-payment-index-migration-plan.md. Listed in build order: lowest risk
 * first, access rows last.
 */
const { COLLECTIONS } = require('./course-payment');

const PENDING_COURSE_INTENT = Object.freeze({ status: 'pending', kind: 'course' });

const COURSE_PAYMENT_INDEXES = Object.freeze([
  {
    id: 'I1',
    collection: COLLECTIONS.intents,
    key: { reference: 1 },
    options: { name: 'uniq_intent_reference', unique: true },
  },
  {
    id: 'I3',
    collection: COLLECTIONS.payments,
    key: { reference: 1 },
    options: { name: 'uniq_payment_reference', unique: true },
  },
  {
    id: 'I6',
    collection: COLLECTIONS.exceptions,
    key: { reference: 1, reason: 1 },
    options: { name: 'uniq_exception_reference_reason', unique: true },
  },
  {
    id: 'I2',
    collection: COLLECTIONS.intents,
    key: { userId: 1, courseId: 1, kind: 1 },
    options: {
      name: 'uniq_pending_intent_per_course',
      unique: true,
      partialFilterExpression: { ...PENDING_COURSE_INTENT },
    },
  },
  {
    id: 'I5',
    collection: COLLECTIONS.coursePurchases,
    key: { userId: 1, courseId: 1 },
    options: { name: 'uniq_purchase_user_course', unique: true },
  },
  {
    id: 'I4',
    collection: COLLECTIONS.courseAccess,
    key: { userId: 1, courseId: 1 },
    options: { name: 'uniq_access_user_course', unique: true },
  },
]);

module.exports = { COURSE_PAYMENT_INDEXES, PENDING_COURSE_INTENT };
