/**
 * Super Admin purchase ledger and payment traceability.
 *
 * Reads the existing payment collections and presents each course entitlement with its linked
 * payment, purchase, checkout, and exception records. It never grants, revokes, reassigns,
 * refunds, or charges. The only writes are review fields and history on `paymentExceptions`
 * and append-only entries in `adminAuditLog`.
 */

const { ObjectId } = require('mongodb');
const { AUDIT_COLLECTION, COLLECTIONS, writeExceptionAudit } = require('./course-payment');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
/** Rows read per ledger request before derived filters apply. Larger sets report `truncated`. */
const SCAN_CAP = 2000;
const SEARCH_MAX = 100;
const NOTE_MAX = 2000;
const REASON_MIN = 3;
const REASON_MAX = 500;
const HEX_ID = /^[a-fA-F0-9]{24}$/;

const SOURCE_LABELS = Object.freeze({
  verified_paystack: 'Verified Paystack purchase',
  complimentary_grant: 'Complimentary grant',
  manual_grant: 'Manual grant',
  historical_backfill: 'Historical / backfill record',
  unverified_record: 'Requires review: no verified payment',
  no_entitlement: 'No active entitlement',
  payment_without_access: 'Payment without course access',
  unlinked_payment: 'Payment not linked to the access record',
});

const EXCEPTION_STATUSES = Object.freeze(['open', 'investigating', 'resolved', 'dismissed']);
const INVESTIGATION_OUTCOMES = Object.freeze([
  'none',
  'owner_confirmed',
  'payer_differs_owner_confirmed',
  'wrong_student_or_course',
  'duplicate_or_test_payment',
  'handled_outside_platform',
  'other',
]);

const EXCEPTION_REASON_LABELS = Object.freeze({
  no_matching_intent: 'Successful charge with no checkout record',
  amount_mismatch: 'Amount does not match the checkout',
  currency_mismatch: 'Currency is not NGN',
  metadata_mismatch: 'Provider metadata does not match the checkout',
  reference_mismatch: 'Reference does not match the checkout',
  lesson_purchase_retired: 'Charge for a retired lesson checkout',
  unreconciled_charge: 'Webhook charge that could not be matched',
  refund_unhandled: 'Refund event recorded',
  dispute_unhandled: 'Dispute event recorded',
  duplicate_payment: 'Additional payment for a course the student already has',
  superseded_intent_paid: 'Payment on a checkout that had been replaced',
  late_conflicting_event: 'Later webhook event conflicts with the verified payment',
});
/** Pending audit repairs handled per list request. */
const AUDIT_REPAIR_BATCH = 20;

function authorizeLedgerAccess(user) {
  return Boolean(user && user.role === 'superadmin');
}

function idKey(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  return null;
}

function toObjectId(value) {
  const key = idKey(value);
  return key && HEX_ID.test(key) ? new ObjectId(key) : null;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lowerEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function numberOrNull(value) {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? n : null;
}

function upperOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

function isBackfill(...rows) {
  return rows.some((row) => row && typeof row.source === 'string' && /backfill/i.test(row.source));
}

function parsePaging(query) {
  const page = Math.max(1, Math.min(10000, parseInt(String(query.page || '1'), 10) || 1));
  const size = parseInt(String(query.pageSize || DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  return { page, pageSize: Math.max(1, Math.min(MAX_PAGE_SIZE, size)) };
}

function parseLedgerQuery(query) {
  const q = cleanText(String(query.q || ''), SEARCH_MAX);
  const source = Object.prototype.hasOwnProperty.call(SOURCE_LABELS, query.source) ? query.source : '';
  const courseId = typeof query.courseId === 'string' && HEX_ID.test(query.courseId) ? query.courseId : '';
  const access = ['active', 'inactive'].includes(query.access) ? query.access : '';
  const review = query.review === 'needs_review' ? 'needs_review' : '';
  return { q, source, courseId, access, review, ...parsePaging(query) };
}

function parseMetadata(raw) {
  let meta = raw;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      return {};
    }
  }
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const key of ['userId', 'courseId', 'lessonId']) {
    if (meta[key] !== undefined && meta[key] !== null && meta[key] !== '') out[key] = String(meta[key]).trim();
  }
  return out;
}

/**
 * Category for one entitlement. Only an access row linked to a successful payment row for the same
 * student and course counts as a verified Paystack purchase. Backfill rows never count as verified.
 */
function classifySource(access, payment) {
  if (!access) return 'payment_without_access';
  if (access.entitlementType === 'complimentary') return 'complimentary_grant';
  if (access.entitlementType === 'manual_grant') return 'manual_grant';
  if (isBackfill(access, payment)) return 'historical_backfill';
  if (access.paid !== true) return 'no_entitlement';
  if (
    payment &&
    payment.status === 'success' &&
    idKey(payment.userId) === idKey(access.userId) &&
    idKey(payment.courseId) === idKey(access.courseId)
  ) {
    return 'verified_paystack';
  }
  return 'unverified_record';
}

/** Payer email is shown only when it was recorded from Paystack at verification time. */
function payerEvidence(payment, category) {
  const email = payment ? lowerEmail(payment.paystackCustomerEmail) : null;
  if (!email) return { email: null, status: 'not_recorded' };
  if (category === 'historical_backfill' || isBackfill(payment)) return { email: null, status: 'copied_from_student' };
  return { email, status: 'recorded_at_verification' };
}

function warning(code, severity, message) {
  return { code, severity, message };
}

function localWarnings(record, rows) {
  const out = [];
  const { access, payment, purchase, intent, exceptions } = rows;
  switch (record.source) {
    case 'historical_backfill':
      out.push(warning('historical_backfill', 'warning', 'Historical backfill record. An operator script wrote it without checking Paystack, so the intended student and course cannot be independently established from local data.'));
      break;
    case 'manual_grant':
    case 'complimentary_grant':
      out.push(warning('administrative_grant', 'info', 'Access was granted by an administrator, not bought through Paystack.'));
      break;
    case 'unverified_record':
      out.push(warning('no_provider_verification', 'warning', 'Access is marked paid, but no successful payment record for this student and course is linked.'));
      break;
    case 'payment_without_access':
      out.push(warning('payment_without_access', 'critical', 'A successful payment is recorded, but the student has no active access to this course.'));
      break;
    case 'unlinked_payment':
      out.push(warning('unlinked_payment', 'warning', 'A successful payment is recorded for this student and course, but the access record points to a different reference. This may be a second charge.'));
      break;
    default:
      break;
  }
  if (access && payment && (idKey(payment.userId) !== idKey(access.userId) || idKey(payment.courseId) !== idKey(access.courseId))) {
    out.push(warning('payment_other_owner', 'critical', 'The linked payment record names a different student or course from the access record.'));
  }
  if (access && purchase && access.paystackReference && purchase.paymentReference && access.paystackReference !== purchase.paymentReference) {
    out.push(warning('reference_disagreement', 'warning', 'The access record and the purchase record name different payment references.'));
  }
  const amounts = [access, payment, purchase, intent].map((r) => (r ? numberOrNull(r.amountKobo) : null)).filter((n) => n !== null);
  if (new Set(amounts).size > 1) {
    out.push(warning('local_amount_disagreement', 'warning', 'Local records disagree on the amount paid.'));
  }
  const currencies = [access, payment, purchase, intent].map((r) => (r ? upperOrNull(r.currency) : null)).filter(Boolean);
  if (new Set(currencies).size > 1) {
    out.push(warning('local_currency_disagreement', 'warning', 'Local records disagree on the currency.'));
  }
  if (record.payer.email && record.student.email && record.payer.email !== record.student.email) {
    out.push(warning('payer_email_differs', 'warning', "The payer email recorded from Paystack differs from the student's email. This is common (for example a parent paying) and is not proof of a problem."));
  }
  if (!record.student.found) out.push(warning('student_missing', 'warning', 'The student account no longer exists.'));
  if (!record.course.found) out.push(warning('course_missing', 'warning', 'The course no longer exists.'));
  if (record.refundDispute !== 'none_recorded') {
    out.push(warning('refund_or_dispute', 'warning', 'Paystack reported a refund or dispute for this reference. Access was not changed automatically. Check the outcome in the Paystack dashboard, then record your review here; provider-side disputes are resolved with Paystack.'));
  }
  const open = (exceptions || []).filter((e) => !(e.resolved === true || (e.review && ['resolved', 'dismissed'].includes(e.review.status))));
  if (open.length) out.push(warning('open_exception', 'warning', `${open.length} unresolved payment exception(s) recorded for this reference.`));
  return out;
}

function buildRecord(rows) {
  const { access, payment, purchase, intent, exceptions, user, course, kind, docId } = rows;
  const source = kind === 'payment' ? rows.paymentCategory : classifySource(access, payment);
  const userId = idKey((access && access.userId) || (payment && payment.userId));
  const courseId = idKey((access && access.courseId) || (payment && payment.courseId));
  const payer = payerEvidence(payment, source);
  const backfill = source === 'historical_backfill';
  const refundDispute = (exceptions || []).some((e) => e.reason === 'dispute_unhandled')
    ? 'dispute_recorded'
    : (exceptions || []).some((e) => e.reason === 'refund_unhandled')
      ? 'refund_recorded'
      : 'none_recorded';
  const primary = payment || access || purchase || {};
  const entitled = Boolean(access && (access.paid === true || ['complimentary', 'manual_grant'].includes(access.entitlementType)));
  const record = {
    id: `${kind === 'payment' ? 'p' : 'a'}_${docId}`,
    kind,
    createdAt: toIso((access && access.createdAt) || (payment && (payment.createdAt || payment.paidAt))),
    student: {
      userId,
      name: user && typeof user.name === 'string' ? user.name : null,
      email: user ? lowerEmail(user.email) : null,
      role: user && typeof user.role === 'string' ? user.role : null,
      found: Boolean(user),
    },
    course: { courseId, title: course && typeof course.title === 'string' ? course.title : null, found: Boolean(course) },
    amountKobo: numberOrNull(primary.amountKobo),
    currency: upperOrNull(primary.currency),
    paymentStatus: payment && typeof payment.status === 'string' ? payment.status : null,
    purchaseStatus: purchase && typeof purchase.status === 'string' ? purchase.status : null,
    accessStatus: access ? (entitled ? 'active' : 'inactive') : 'none',
    source,
    sourceLabel: SOURCE_LABELS[source],
    paystackReference: (payment && payment.reference) || (access && access.paystackReference) || (purchase && purchase.paymentReference) || null,
    checkoutReference: intent && intent.reference ? intent.reference : null,
    verification: {
      basis: backfill
        ? 'none_backfill'
        : source === 'verified_paystack' || source === 'payment_without_access' || source === 'unlinked_payment'
          ? (intent ? 'checkout_intent' : 'legacy_server_verification')
          : 'none',
      at: backfill ? null : toIso((access && access.verifiedAt) || (payment && payment.paidAt)),
    },
    payer,
    refundDispute,
    openExceptions: (exceptions || []).filter((e) => !(e.resolved === true || (e.review && ['resolved', 'dismissed'].includes(e.review.status)))).length,
  };
  record.warnings = localWarnings(record, rows);
  record.needsReview = record.warnings.some((w) => w.severity !== 'info');
  return record;
}

async function findByIds(db, name, ids, projection) {
  const oids = [...new Set(ids.filter(Boolean))].map(toObjectId).filter(Boolean);
  if (!oids.length) return new Map();
  const rows = await db.collection(name).find({ _id: { $in: oids } }, { projection }).toArray();
  return new Map(rows.map((r) => [idKey(r._id), r]));
}

async function findByField(db, name, field, values, projection) {
  const list = [...new Set(values.filter(Boolean))];
  if (!list.length) return [];
  return db.collection(name).find({ [field]: { $in: list } }, { projection }).toArray();
}

const pairKey = (u, c) => `${idKey(u)}|${idKey(c)}`;

/** Joins access rows and payment-only rows with every linked record. */
async function buildRecords(db, accessRows, paymentRows) {
  const userIds = [...accessRows.map((r) => idKey(r.userId)), ...paymentRows.map((r) => idKey(r.userId))];
  const purchases = await findByField(db, COLLECTIONS.coursePurchases, 'userId', userIds, { _id: 0 });
  const purchaseByPair = new Map(purchases.map((p) => [pairKey(p.userId, p.courseId), p]));

  const pairAccess = await findByField(db, COLLECTIONS.courseAccess, 'userId', paymentRows.map((r) => idKey(r.userId)), {});
  const accessByPair = new Map();
  for (const row of [...pairAccess, ...accessRows]) accessByPair.set(pairKey(row.userId, row.courseId), row);

  const linkedRefs = new Set();
  for (const row of accessByPair.values()) {
    if (row.paystackReference) linkedRefs.add(String(row.paystackReference));
    const purchase = purchaseByPair.get(pairKey(row.userId, row.courseId));
    if (purchase && purchase.paymentReference) linkedRefs.add(String(purchase.paymentReference));
  }

  const accessRefs = accessRows.flatMap((r) => {
    const purchase = purchaseByPair.get(pairKey(r.userId, r.courseId));
    return [r.paystackReference, purchase && purchase.paymentReference].filter(Boolean).map(String);
  });
  const extraPayments = paymentRows.filter((p) => !linkedRefs.has(String(p.reference)));
  const allRefs = [...accessRefs, ...extraPayments.map((p) => String(p.reference))];

  const [payments, intents, exceptions] = await Promise.all([
    findByField(db, COLLECTIONS.payments, 'reference', allRefs, {}),
    findByField(db, COLLECTIONS.intents, 'reference', allRefs, {}),
    findByField(db, COLLECTIONS.exceptions, 'reference', allRefs, {}),
  ]);
  const paymentByRef = new Map(payments.map((p) => [String(p.reference), p]));
  const intentByRef = new Map(intents.map((i) => [String(i.reference), i]));
  const exceptionsByRef = new Map();
  for (const e of exceptions) {
    const list = exceptionsByRef.get(String(e.reference)) || [];
    list.push(e);
    exceptionsByRef.set(String(e.reference), list);
  }

  const courseIds = [...accessRows.map((r) => idKey(r.courseId)), ...extraPayments.map((r) => idKey(r.courseId))];
  const [users, courses] = await Promise.all([
    findByIds(db, 'users', [...accessRows.map((r) => idKey(r.userId)), ...extraPayments.map((r) => idKey(r.userId))], { name: 1, email: 1, role: 1 }),
    findByIds(db, 'courses', courseIds, { title: 1 }),
  ]);

  const records = [];
  for (const access of accessRows) {
    const purchase = purchaseByPair.get(pairKey(access.userId, access.courseId)) || null;
    const ref = access.paystackReference || (purchase && purchase.paymentReference) || null;
    const rows = {
      access,
      purchase,
      payment: ref ? paymentByRef.get(String(ref)) || null : null,
      intent: ref ? intentByRef.get(String(ref)) || null : null,
      exceptions: ref ? exceptionsByRef.get(String(ref)) || [] : [],
    };
    records.push({
      record: buildRecord({
        kind: 'access',
        docId: idKey(access._id),
        ...rows,
        user: users.get(idKey(access.userId)) || null,
        course: courses.get(idKey(access.courseId)) || null,
      }),
      rows,
    });
  }
  for (const payment of extraPayments) {
    const pairAccessRow = accessByPair.get(pairKey(payment.userId, payment.courseId)) || null;
    const entitled = Boolean(pairAccessRow && (pairAccessRow.paid === true || ['complimentary', 'manual_grant'].includes(pairAccessRow.entitlementType)));
    const ref = String(payment.reference);
    const rows = {
      payment,
      purchase: purchaseByPair.get(pairKey(payment.userId, payment.courseId)) || null,
      intent: intentByRef.get(ref) || null,
      exceptions: exceptionsByRef.get(ref) || [],
    };
    records.push({
      record: buildRecord({
        kind: 'payment',
        docId: idKey(payment._id),
        paymentCategory: entitled ? 'unlinked_payment' : 'payment_without_access',
        access: null,
        ...rows,
        user: users.get(idKey(payment.userId)) || null,
        course: courses.get(idKey(payment.courseId)) || null,
      }),
      rows: { access: null, ...rows },
    });
  }
  return records;
}

async function searchCriteria(db, q) {
  if (!q) return null;
  const pattern = new RegExp(escapeRegex(q), 'i');
  const [users, courses] = await Promise.all([
    db.collection('users').find({ $or: [{ email: pattern }, { name: pattern }] }, { projection: { _id: 1 } }).limit(200).toArray(),
    db.collection('courses').find({ title: pattern }, { projection: { _id: 1 } }).limit(50).toArray(),
  ]);
  const userIds = users.map((u) => idKey(u._id));
  const courseIds = courses.map((c) => idKey(c._id));
  if (HEX_ID.test(q)) {
    userIds.push(q);
    courseIds.push(q);
  }
  return { reference: q, userIds, courseIds };
}

async function listPurchases(db, query) {
  const filter = parseLedgerQuery(query || {});
  const crit = await searchCriteria(db, filter.q);
  const accessQuery = {};
  const paymentQuery = { kind: 'course', status: 'success' };
  if (filter.courseId) {
    accessQuery.courseId = filter.courseId;
    paymentQuery.courseId = filter.courseId;
  }
  if (crit) {
    accessQuery.$or = [{ paystackReference: crit.reference }, { userId: { $in: crit.userIds } }, { courseId: { $in: crit.courseIds } }];
    paymentQuery.$or = [{ reference: crit.reference }, { userId: { $in: crit.userIds } }, { courseId: { $in: crit.courseIds } }];
  }
  const [accessRows, paymentRows] = await Promise.all([
    db.collection(COLLECTIONS.courseAccess).find(accessQuery).sort({ createdAt: -1 }).limit(SCAN_CAP + 1).toArray(),
    db.collection(COLLECTIONS.payments).find(paymentQuery).sort({ createdAt: -1 }).limit(SCAN_CAP + 1).toArray(),
  ]);
  const truncated = accessRows.length > SCAN_CAP || paymentRows.length > SCAN_CAP;
  const built = await buildRecords(db, accessRows.slice(0, SCAN_CAP), paymentRows.slice(0, SCAN_CAP));
  const matching = built
    .map((b) => b.record)
    .filter((r) => !filter.source || r.source === filter.source)
    .filter((r) => !filter.access || (filter.access === 'active' ? r.accessStatus === 'active' : r.accessStatus !== 'active'))
    .filter((r) => !filter.review || r.needsReview)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const total = matching.length;
  const start = (filter.page - 1) * filter.pageSize;
  return {
    items: matching.slice(start, start + filter.pageSize),
    page: filter.page,
    pageSize: filter.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filter.pageSize)),
    truncated,
    totalIsLowerBound: truncated,
    scanCap: SCAN_CAP,
    filters: { q: filter.q, source: filter.source, courseId: filter.courseId, access: filter.access, review: filter.review },
  };
}

function parseRecordId(id) {
  const match = /^([ap])_([a-fA-F0-9]{24})$/.exec(String(id || ''));
  return match ? { kind: match[1] === 'p' ? 'payment' : 'access', oid: new ObjectId(match[2]) } : null;
}

function presentAccess(row) {
  if (!row) return null;
  return {
    paid: row.paid === true ? true : row.paid === false ? false : null,
    paidFieldPresent: Object.prototype.hasOwnProperty.call(row, 'paid'),
    entitlementType: row.entitlementType || null,
    source: row.source || null,
    paystackReference: row.paystackReference || null,
    amountKobo: numberOrNull(row.amountKobo),
    currency: upperOrNull(row.currency),
    unlockedAt: toIso(row.unlockedAt),
    verifiedAt: toIso(row.verifiedAt),
    createdAt: toIso(row.createdAt),
  };
}

function presentPurchase(row) {
  if (!row) return null;
  return {
    status: row.status || null,
    paymentReference: row.paymentReference || null,
    amountKobo: numberOrNull(row.amountKobo),
    currency: upperOrNull(row.currency),
    verifiedAt: toIso(row.verifiedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function presentPayment(row) {
  if (!row) return null;
  return {
    reference: row.reference || null,
    status: row.status || null,
    kind: row.kind || null,
    source: row.source || null,
    amountKobo: numberOrNull(row.amountKobo),
    currency: upperOrNull(row.currency),
    userId: idKey(row.userId),
    courseId: idKey(row.courseId),
    paidAt: toIso(row.paidAt),
    createdAt: toIso(row.createdAt),
    storedMetadata: row.metadata ? parseMetadata(row.metadata) : null,
  };
}

function presentIntent(row) {
  if (!row) return null;
  return {
    reference: row.reference || null,
    kind: row.kind || null,
    status: row.status || null,
    amountKobo: numberOrNull(row.amountKobo),
    currency: upperOrNull(row.currency),
    createdAt: toIso(row.createdAt),
    expiresAt: toIso(row.expiresAt),
    paidAt: toIso(row.paidAt),
    closedAt: toIso(row.closedAt),
  };
}

function exceptionStatus(row) {
  if (row.review && EXCEPTION_STATUSES.includes(row.review.status)) return row.review.status;
  return row.resolved === true ? 'resolved' : 'open';
}

function presentException(row) {
  return {
    id: idKey(row._id),
    reference: row.reference || null,
    reason: row.reason || null,
    reasonLabel: EXCEPTION_REASON_LABELS[row.reason] || 'Other',
    source: row.source || null,
    providerStatus: row.providerStatus || null,
    amountKobo: numberOrNull(row.amountKobo),
    currency: upperOrNull(row.currency),
    userId: idKey(row.userId),
    courseId: idKey(row.courseId),
    occurrences: numberOrNull(row.occurrences),
    createdAt: toIso(row.createdAt),
    lastSeenAt: toIso(row.lastSeenAt),
    status: exceptionStatus(row),
    outcome: (row.review && row.review.outcome) || 'none',
    notes: (row.review && row.review.notes) || '',
    reviewedAt: toIso(row.review && row.review.updatedAt),
    reviewedBy: row.review && row.review.updatedBy ? { userId: idKey(row.review.updatedBy.userId), email: row.review.updatedBy.email || null } : null,
    history: Array.isArray(row.reviewHistory)
      ? row.reviewHistory.map((h) => ({
          at: toIso(h.at),
          actor: h.actor ? { userId: idKey(h.actor.userId), email: h.actor.email || null } : null,
          reason: h.reason || '',
          action: h.action || 'exception_review',
          before: h.before || null,
          after: h.after || null,
        }))
      : [],
    auditPending: Array.isArray(row.pendingAuditIds) && row.pendingAuditIds.length > 0,
  };
}

function presentAudit(row) {
  return {
    id: idKey(row._id),
    entityType: row.entityType,
    entityId: row.entityId,
    reference: row.reference || null,
    action: row.action,
    reason: row.reason || '',
    before: row.before === undefined ? null : row.before,
    after: row.after === undefined ? null : row.after,
    actor: row.actor ? { userId: idKey(row.actor.userId), email: row.actor.email || null } : null,
    createdAt: toIso(row.createdAt),
  };
}

async function loadRecord(db, id) {
  const parsed = parseRecordId(id);
  if (!parsed) return null;
  const name = parsed.kind === 'payment' ? COLLECTIONS.payments : COLLECTIONS.courseAccess;
  const doc = await db.collection(name).findOne({ _id: parsed.oid });
  if (!doc) return null;
  if (parsed.kind === 'payment' && !(doc.kind === 'course' && doc.status === 'success')) return null;
  const built = await buildRecords(db, parsed.kind === 'access' ? [doc] : [], parsed.kind === 'payment' ? [doc] : []);
  if (!built.length) {
    const linked =
      (await db.collection(COLLECTIONS.courseAccess).findOne({ paystackReference: doc.reference })) ||
      (await db.collection(COLLECTIONS.courseAccess).findOne({ userId: doc.userId, courseId: doc.courseId }));
    return linked ? { redirectTo: `a_${idKey(linked._id)}` } : null;
  }
  return built[0];
}

async function getPurchaseDetail(db, id) {
  const loaded = await loadRecord(db, id);
  if (!loaded) return null;
  if (loaded.redirectTo) return { redirectTo: loaded.redirectTo };
  const { record, rows } = loaded;
  const auditQuery = record.paystackReference
    ? { $or: [{ entityId: record.id }, { reference: record.paystackReference }] }
    : { entityId: record.id };
  const audit = await db.collection(AUDIT_COLLECTION).find(auditQuery).sort({ createdAt: -1 }).limit(100).toArray();
  return {
    record,
    linked: {
      access: presentAccess(rows.access),
      purchase: presentPurchase(rows.purchase),
      payment: presentPayment(rows.payment),
      checkout: presentIntent(rows.intent),
      exceptions: (rows.exceptions || []).map(presentException),
    },
    notes: {
      storedMetadata: 'Stored payment metadata was written by this application, not received from Paystack.',
      verifiedAt: record.source === 'historical_backfill' ? 'The backfill script set verifiedAt when it ran. It is not a provider verification time.' : null,
    },
    audit: audit.map(presentAudit),
  };
}

/** Compares a provider lookup with the local record. Provider metadata is evidence, not proof of the beneficiary. */
function compareWithProvider(record, lookup) {
  if (!lookup || lookup.outcome === 'uncertain') {
    return { outcome: 'unavailable', reason: (lookup && lookup.reason) || 'unknown', warnings: [] };
  }
  if (lookup.outcome === 'not_found') {
    return { outcome: 'not_found', warnings: [warning('provider_not_found', 'critical', 'Paystack has no transaction with this reference.')] };
  }
  const data = lookup.data || {};
  const meta = parseMetadata(data.metadata);
  const payerEmail = lowerEmail(data.customer && data.customer.email);
  const amount = numberOrNull(data.amount);
  const currency = upperOrNull(data.currency);
  const out = [];
  if (String(data.status || '').toLowerCase() !== 'success') {
    out.push(warning('provider_not_successful', 'critical', `Paystack reports status "${String(data.status || 'unknown')}".`));
  }
  if (record.paystackReference && data.reference && String(data.reference) !== String(record.paystackReference)) {
    out.push(warning('provider_reference_mismatch', 'critical', 'Paystack returned a different reference.'));
  }
  if (record.amountKobo !== null && amount !== record.amountKobo) {
    out.push(warning('provider_amount_mismatch', 'critical', 'Paystack amount differs from the local amount.'));
  }
  if (record.currency && currency !== record.currency) {
    out.push(warning('provider_currency_mismatch', 'critical', 'Paystack currency differs from the local currency.'));
  }
  if (meta.courseId === undefined) {
    out.push(warning('provider_course_missing', 'warning', 'Paystack metadata has no course ID, so the intended course cannot be confirmed from the provider.'));
  } else if (meta.courseId !== record.course.courseId) {
    out.push(warning('provider_course_conflict', 'critical', 'Paystack metadata names a different course from the local record.'));
  }
  if (meta.userId === undefined) {
    out.push(warning('provider_user_missing', 'warning', 'Paystack metadata has no user ID, so the intended student cannot be confirmed from the provider.'));
  } else if (meta.userId !== record.student.userId) {
    out.push(warning('provider_user_conflict', 'critical', 'Paystack metadata names a different user ID from the local record.'));
  }
  if (meta.lessonId !== undefined) {
    out.push(warning('provider_lesson_metadata', 'warning', 'Paystack metadata names a lesson. Lesson purchases are retired.'));
  }
  if (payerEmail && record.student.email && payerEmail !== record.student.email) {
    out.push(warning('payer_email_differs', 'warning', "Paystack payer email differs from the student's email. This alone is not proof of a problem."));
  }
  return {
    outcome: 'found',
    provider: {
      domain: data.domain || null,
      status: data.status || null,
      reference: data.reference || null,
      amountKobo: amount,
      currency,
      paidAt: toIso(data.paid_at || data.paidAt),
      channel: data.channel || null,
      metadata: meta,
      payerEmail,
    },
    warnings: out,
  };
}

function actorOf(user) {
  return { userId: String(user.userId), email: typeof user.email === 'string' ? user.email : null };
}

async function appendAudit(db, entry) {
  await db.collection(AUDIT_COLLECTION).insertOne({
    entityType: entry.entityType,
    entityId: entry.entityId,
    reference: entry.reference || null,
    action: entry.action,
    reason: entry.reason || '',
    before: entry.before === undefined ? null : entry.before,
    after: entry.after === undefined ? null : entry.after,
    actor: entry.actor,
    createdAt: entry.now,
  });
}

/** Provider lookups are audited by warning codes only; no provider customer data is stored. */
async function checkPurchaseWithProvider(db, id, options) {
  const loaded = await loadRecord(db, id);
  if (!loaded || loaded.redirectTo) return { ok: false, status: 404 };
  const { record } = loaded;
  if (!record.paystackReference) return { ok: true, result: { outcome: 'no_reference', warnings: [] } };
  const lookup = await options.fetchTransaction(String(record.paystackReference));
  const result = compareWithProvider(record, lookup);
  await appendAudit(db, {
    entityType: 'purchase',
    entityId: record.id,
    reference: record.paystackReference,
    action: 'provider_check',
    reason: 'Read-only Paystack verification lookup',
    after: { outcome: result.outcome, warnings: result.warnings.map((w) => w.code) },
    actor: actorOf(options.actor),
    now: options.now || new Date(),
  });
  return { ok: true, result };
}

function validateReview(input) {
  const reason = cleanText(input && input.reason, REASON_MAX);
  if (reason.length < REASON_MIN) return { ok: false, message: 'Give a reason for this change.' };
  const notes = cleanText(input && input.notes, NOTE_MAX);
  const outcome = input && INVESTIGATION_OUTCOMES.includes(input.outcome) ? input.outcome : null;
  if (!outcome) return { ok: false, message: 'Choose an investigation outcome.' };
  return { ok: true, reason, notes, outcome };
}

/** Adds an investigation note to a purchase. Purchase, payment, and access records are not changed. */
async function addPurchaseNote(db, id, input, actor, now) {
  const checked = validateReview(input);
  if (!checked.ok) return { ok: false, status: 400, message: checked.message };
  const loaded = await loadRecord(db, id);
  if (!loaded || loaded.redirectTo) return { ok: false, status: 404, message: 'Purchase not found.' };
  await appendAudit(db, {
    entityType: 'purchase',
    entityId: loaded.record.id,
    reference: loaded.record.paystackReference,
    action: 'review_note',
    reason: checked.reason,
    before: null,
    after: { outcome: checked.outcome, notes: checked.notes },
    actor: actorOf(actor),
    now: now || new Date(),
  });
  return { ok: true };
}

function exceptionStatusQuery(status) {
  if (status === 'open') {
    return { resolved: { $ne: true }, $or: [{ 'review.status': { $exists: false } }, { 'review.status': 'open' }] };
  }
  if (['investigating', 'resolved', 'dismissed'].includes(status)) return { 'review.status': status };
  return {};
}

async function listExceptions(db, query) {
  await repairPendingExceptionAudits(db);
  const q = query || {};
  const { page, pageSize } = parsePaging(q);
  const status = ['open', 'investigating', 'resolved', 'dismissed', 'all'].includes(q.status) ? q.status : 'open';
  const filter = { ...exceptionStatusQuery(status) };
  if (typeof q.reason === 'string' && Object.prototype.hasOwnProperty.call(EXCEPTION_REASON_LABELS, q.reason)) filter.reason = q.reason;
  const search = cleanText(String(q.q || ''), SEARCH_MAX);
  if (search) filter.reference = new RegExp(`^${escapeRegex(search)}`, 'i');
  const col = db.collection(COLLECTIONS.exceptions);
  const [rows, total] = await Promise.all([
    col.find(filter).sort({ lastSeenAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items: rows.map(presentException), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), status };
}

/**
 * Records an investigation outcome on an exception. Original evidence fields are never changed.
 * The review and its history entry are written in one document update, guarded by `reviewVersion`.
 * That update also reserves the audit entry's id in `pendingAuditIds`; if the audit insert then
 * fails, the caller gets a 500 that says the review was saved, and the entry is written later by
 * `repairPendingExceptionAudits`.
 */
async function updateException(db, id, input, actor, now) {
  if (typeof id !== 'string' || !HEX_ID.test(id)) return { ok: false, status: 404, message: 'Exception not found.' };
  const checked = validateReview(input);
  if (!checked.ok) return { ok: false, status: 400, message: checked.message };
  const status = input && EXCEPTION_STATUSES.includes(input.status) ? input.status : null;
  if (!status) return { ok: false, status: 400, message: 'Choose a resolution status.' };
  const col = db.collection(COLLECTIONS.exceptions);
  const oid = new ObjectId(id);
  const doc = await col.findOne({ _id: oid });
  if (!doc) return { ok: false, status: 404, message: 'Exception not found.' };
  const before = { status: exceptionStatus(doc), outcome: (doc.review && doc.review.outcome) || 'none', notes: (doc.review && doc.review.notes) || '' };
  const after = { status, outcome: checked.outcome, notes: checked.notes };
  if (before.status === after.status && before.outcome === after.outcome && before.notes === after.notes) {
    return { ok: false, status: 400, message: 'Nothing changed.' };
  }
  const at = now || new Date();
  const who = actorOf(actor);
  const version = Number.isInteger(doc.reviewVersion) ? doc.reviewVersion : 0;
  const auditId = new ObjectId();
  const result = await col.updateOne(
    { _id: oid, ...(version === 0 ? { reviewVersion: { $exists: false } } : { reviewVersion: version }) },
    {
      $set: {
        review: { status, outcome: checked.outcome, notes: checked.notes, updatedAt: at, updatedBy: who },
        resolved: status === 'resolved' || status === 'dismissed',
        reviewVersion: version + 1,
        pendingAuditIds: [...(Array.isArray(doc.pendingAuditIds) ? doc.pendingAuditIds : []), auditId],
      },
      $push: { reviewHistory: { at, actor: who, reason: checked.reason, before, after, action: 'exception_review', auditId } },
    }
  );
  if (!result.matchedCount) return { ok: false, status: 409, message: 'Someone else updated this exception. Reload and try again.' };
  const audited = await writeExceptionAudit(db, auditEntryFor(doc, { at, actor: who, reason: checked.reason, before, after, action: 'exception_review', auditId }), oid);
  const updated = await col.findOne({ _id: oid });
  if (!audited) {
    return {
      ok: false,
      status: 500,
      reviewSaved: true,
      message: 'The review was saved, but its audit entry could not be written. It will be written automatically the next time the ledger loads.',
      exception: presentException(updated),
    };
  }
  return { ok: true, exception: presentException(updated) };
}

function auditEntryFor(doc, entry) {
  return {
    _id: entry.auditId,
    entityType: 'payment_exception',
    entityId: idKey(doc._id),
    reference: doc.reference || null,
    action: entry.action || 'exception_review',
    reason: entry.reason || '',
    before: entry.before === undefined ? null : entry.before,
    after: entry.after === undefined ? null : entry.after,
    actor: entry.actor,
    createdAt: entry.at,
  };
}

/**
 * Writes audit entries for review changes whose audit insert did not complete. Each entry is
 * rebuilt from the matching review history item and inserted under its reserved id, so a repair
 * that races the original insert cannot create a second copy.
 */
async function repairPendingExceptionAudits(db) {
  const col = db.collection(COLLECTIONS.exceptions);
  const rows = await col.find({ 'pendingAuditIds.0': { $exists: true } }).limit(AUDIT_REPAIR_BATCH).toArray();
  let repaired = 0;
  for (const doc of rows) {
    for (const auditId of doc.pendingAuditIds) {
      const entry = (doc.reviewHistory || []).find((h) => h.auditId && idKey(h.auditId) === idKey(auditId));
      if (!entry) continue;
      if (await writeExceptionAudit(db, auditEntryFor(doc, entry), doc._id)) repaired += 1;
    }
  }
  return { repaired };
}

async function listAudit(db, query) {
  await repairPendingExceptionAudits(db);
  const q = query || {};
  const { page, pageSize } = parsePaging(q);
  const filter = {};
  if (['purchase', 'payment_exception'].includes(q.entityType)) filter.entityType = q.entityType;
  const search = cleanText(String(q.q || ''), SEARCH_MAX);
  if (search) filter.reference = new RegExp(`^${escapeRegex(search)}`, 'i');
  const col = db.collection(AUDIT_COLLECTION);
  const [rows, total] = await Promise.all([
    col.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items: rows.map(presentAudit), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = {
  AUDIT_COLLECTION,
  EXCEPTION_REASON_LABELS,
  EXCEPTION_STATUSES,
  INVESTIGATION_OUTCOMES,
  MAX_PAGE_SIZE,
  SCAN_CAP,
  SOURCE_LABELS,
  addPurchaseNote,
  authorizeLedgerAccess,
  checkPurchaseWithProvider,
  classifySource,
  compareWithProvider,
  getPurchaseDetail,
  listAudit,
  listExceptions,
  listPurchases,
  parseLedgerQuery,
  payerEvidence,
  repairPendingExceptionAudits,
  updateException,
};
