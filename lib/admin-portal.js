'use strict';

/**
 * Admin portal (Phase 13): read models for platform operations, and safe CSV exports.
 * Read-only except exports, which only write their own audit entry. No financial record, account,
 * enrollment or entitlement is changed here: those changes keep their existing, audited routes
 * (approvals and suspension, course status, reassignment, course access grants, refunds,
 * reconciliation).
 *
 * Roles (unchanged policy):
 *   admin + superadmin   overview (non-financial), users and instructors, courses, enrollments
 *                        (without payment references), non-financial reports, course and enrollment
 *                        exports, platform configuration (read-only)
 *   superadmin only      payment figures, payments monitor, refunds, reconciliation, financial
 *                        reports, user/payment/refund/audit exports, account history, phone numbers
 * The financial and Super Admin-only parts are left out of the response for an ordinary admin,
 * not merely hidden in the interface.
 *
 * Money: kobo integers summed with BigInt and presented as decimal naira strings (2 places). Never
 * floating point. Pending checkouts are never counted as revenue.
 *
 * Checkout states (paystackPaymentIntents, the record of every checkout):
 *   paid        confirmed by the server-side verification or the signed webhook
 *   held        a verified charge kept for review (duplicate or superseded checkout); not applied
 *   confirming  a confirmation is in progress (claimed less than CLAIM_TTL_MS ago)
 *   stalled     a confirmation stopped (claimed longer ago): reconciliation R1 finishes it
 *   pending     checkout created, no payment reported yet, younger than ABANDON_AFTER_MS
 *   abandoned   pending and older than that, or past its expiry: no payment was reported. This is
 *               not a provider "failed" status; a late payment is still found by reconciliation.
 *   closed      replaced by a newer checkout (expired / superseded)
 * Refunds overlay a paid checkout: refunded (processed refunds = amount), partially refunded,
 * refund pending (an open refund exists).
 */

const { ObjectId } = require('mongodb');
const { CLAIM_TTL_MS, COLLECTIONS, COURSE_PRICE_KOBO, COURSE_CURRENCY, decidePaymentEnvironment, isEntitledRow } = require('./course-payment');
const { AUDIT_COLLECTION } = require('./course-payment');
const { REFUND_OPEN } = require('./payment-refunds');
const { isActiveEnrollment } = require('./enrollment-state');
const { COURSE_STATUSES } = require('./course-lifecycle');
const { dayKey, shiftDay } = require('./learning-activity');

const DAY_MS = 24 * 3600 * 1000;
const ABANDON_AFTER_MS = 24 * 3600 * 1000;
const WINDOWS = Object.freeze([7, 30, 90, 365]);
const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const EXPORT_MAX_ROWS = 10000;
const STORED_ID = /^[a-fA-F0-9]{24}$/;
const ADMIN_ROLES = new Set(['admin', 'superadmin']);
const PAYMENT_STATES = Object.freeze(['paid', 'held', 'confirming', 'stalled', 'pending', 'abandoned', 'closed', 'refunded']);
const ACCOUNT_STATUSES = Object.freeze(['active', 'pending', 'suspended', 'rejected']);
const EXPORT_TYPES = Object.freeze({ courses: 'admin', enrollments: 'admin', users: 'superadmin', payments: 'superadmin', refunds: 'superadmin', audit: 'superadmin' });

const isId = (v) => typeof v === 'string' && STORED_ID.test(v);
const oid = (v) => new ObjectId(String(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);
const time = (v) => (v ? new Date(v).getTime() || 0 : 0);
const text = (v, fallback = '') => (typeof v === 'string' && v ? v : fallback);
const isSuper = (m) => Boolean(m && m.role === 'superadmin');
const refuse = (status, error) => ({ ok: false, status, error });
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round1 = (n) => Math.round(n * 10) / 10;

function guard(member, { superOnly = false } = {}) {
  if (!member || !ADMIN_ROLES.has(member.role)) return refuse(403, 'Not authorized');
  if (superOnly && !isSuper(member)) return refuse(403, 'Only the Super Admin can view this.');
  return null;
}

function paging(page, limit) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isInteger(limit) ? limit : PAGE_SIZE));
  const number = Math.max(1, Number.isInteger(page) ? page : 1);
  return { page: number, limit: size, skip: (number - 1) * size };
}
const pageInfo = (pg, total) => ({ page: pg.page, limit: pg.limit, total, pages: Math.max(1, Math.ceil(total / pg.limit)) });

/** A search term: trimmed, at most 80 characters, as an escaped case-insensitive regex. */
function searchRegex(q) {
  const term = typeof q === 'string' ? q.trim().slice(0, 80) : '';
  return term ? new RegExp(escapeRegex(term), 'i') : null;
}

/** Kobo (integer or numeric string) to a BigInt; anything else is 0. */
function kobo(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return 0n;
}
/** BigInt kobo to a naira string with 2 decimals ("12500.00"). */
function naira(k) {
  const neg = k < 0n;
  const abs = neg ? -k : k;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Window in days (7, 30, 90, 365; default 30). */
const windowDays = (d) => (WINDOWS.includes(d) ? d : 30);

const activeFilter = Object.freeze({ $or: [{ status: 'approved' }, { status: { $exists: false } }, { status: null }, { status: '' }] });
function accountStatusFilter(status) {
  if (status === 'active') return activeFilter;
  if (status === 'pending' || status === 'suspended' || status === 'rejected') return { status };
  return {};
}
const accountStatusOf = (s) => (!s || s === 'approved' ? 'active' : String(s));

/** Checkout state at `now` (see the header). */
function checkoutState(intent, now = new Date()) {
  const s = intent && intent.status;
  if (s === 'paid') return 'paid';
  if (s === 'held') return 'held';
  if (s === 'processing') return now.getTime() - time(intent.claimedAt) > CLAIM_TTL_MS ? 'stalled' : 'confirming';
  if (s === 'pending' || s == null) {
    const expired = intent.expiresAt && time(intent.expiresAt) < now.getTime();
    return expired || now.getTime() - time(intent.createdAt) > ABANDON_AFTER_MS ? 'abandoned' : 'pending';
  }
  if (s === 'expired' || s === 'superseded') return 'closed';
  return 'unknown';
}

/** Refund summary per payment reference: processed kobo, open count. */
async function refundSummaries(db, references) {
  const refs = [...new Set(references.filter(Boolean).map(String))];
  if (!refs.length) return new Map();
  const rows = await db.collection(COLLECTIONS.refunds).find({ paymentReference: { $in: refs } }, { projection: { paymentReference: 1, amountKobo: 1, status: 1 } }).toArray();
  const map = new Map();
  for (const r of rows) {
    const k = String(r.paymentReference);
    const v = map.get(k) || { processed: 0n, open: 0 };
    if (r.status === 'processed') v.processed += kobo(r.amountKobo);
    else if (REFUND_OPEN.includes(r.status)) v.open += 1;
    map.set(k, v);
  }
  return map;
}
function refundStateOf(intent, summary) {
  if (!summary || intent.status !== 'paid') return null;
  if (summary.processed > 0n && summary.processed >= kobo(intent.amountKobo)) return 'refunded';
  if (summary.processed > 0n) return 'partially_refunded';
  if (summary.open > 0) return 'refund_pending';
  return null;
}

async function namesFor(db, userIds, { withEmail = false } = {}) {
  const ids = [...new Set(userIds.filter(isId))];
  if (!ids.length) return new Map();
  const rows = await db.collection('users').find({ _id: { $in: ids.map(oid) } }, { projection: { name: 1, role: 1, status: 1, ...(withEmail ? { email: 1 } : {}) } }).toArray();
  return new Map(rows.map((u) => [String(u._id), { name: text(u.name, 'User'), role: u.role, status: accountStatusOf(u.status), ...(withEmail ? { email: text(u.email) } : {}) }]));
}
async function courseTitles(db, courseIds) {
  const ids = [...new Set(courseIds.map(String).filter(isId))];
  if (!ids.length) return new Map();
  const rows = await db.collection('courses').find({ _id: { $in: ids.map(oid) } }, { projection: { title: 1, status: 1, instructorId: 1 } }).toArray();
  return new Map(rows.map((c) => [String(c._id), { title: text(c.title, 'Course'), status: c.status || 'published', instructorId: c.instructorId ? String(c.instructorId) : null }]));
}
const openExceptionFilter = Object.freeze({ $or: [{ 'review.status': { $in: ['open', 'investigating'] } }, { 'review.status': { $exists: false } }, { review: null }] });

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * Metric sources (window = last `days` days):
 *   students / instructors      users by role; active = status approved (or none, legacy)
 *   suspended / pending          users by status (pending approvals shown to the Super Admin only)
 *   new registrations            users with createdAt in the window; trend by Africa/Lagos day
 *   active learners              distinct students with a learning day in the window (learningDays)
 *   courses                      by status (draft, in_review, published, archived)
 *   enrollments                  active progress rows; new = enrolledAt/createdAt in window;
 *                                completions = completedAt in window
 *   payments (Super Admin)       checkouts created in the window by state; gross = sum of paid
 *                                checkouts with paidAt in the window; refunds = processed refunds
 *                                updated in the window; net = gross - refunds
 */
async function adminOverview(db, member, { days, now = new Date() } = {}) {
  const denied = guard(member);
  if (denied) return denied;
  const d = windowDays(days);
  const since = new Date(now.getTime() - d * DAY_MS);
  const sinceDay = shiftDay(dayKey(now), -(d - 1));
  const users = db.collection('users');
  const progress = db.collection('progress');
  const [students, activeStudents, instructors, activeInstructors, admins, suspended, pending, newUsers, recentUsers, courseRows, learnerDays, enrollRows] = await Promise.all([
    users.countDocuments({ role: 'student' }),
    users.countDocuments({ role: 'student', ...activeFilter }),
    users.countDocuments({ role: 'instructor' }),
    users.countDocuments({ role: 'instructor', ...activeFilter }),
    users.countDocuments({ role: { $in: ['admin', 'superadmin'] } }),
    users.countDocuments({ status: 'suspended' }),
    users.countDocuments({ status: 'pending' }),
    users.find({ createdAt: { $gte: since } }, { projection: { createdAt: 1, role: 1 } }).limit(50000).toArray(),
    users.find({}, { projection: { name: 1, role: 1, status: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(6).toArray(),
    db.collection('courses').find({}, { projection: { status: 1, instructorId: 1 } }).limit(5000).toArray(),
    db.collection('learningDays').find({ day: { $gte: sinceDay } }, { projection: { userId: 1 } }).limit(200000).toArray(),
    progress.find({}, { projection: { enrolledAt: 1, createdAt: 1, completedAt: 1, withdrawnAt: 1, active: 1 } }).limit(200000).toArray(),
  ]);
  const byStatus = Object.fromEntries(COURSE_STATUSES.map((s) => [s, 0]));
  for (const c of courseRows) byStatus[c.status === undefined ? 'published' : COURSE_STATUSES.includes(c.status) ? c.status : 'draft'] += 1;
  const activeEnrollments = enrollRows.filter(isActiveEnrollment);
  const trend = [];
  const perDay = new Map();
  for (const u of newUsers) { const k = dayKey(new Date(u.createdAt)); perDay.set(k, (perDay.get(k) || 0) + 1); }
  for (let i = d - 1; i >= 0; i -= 1) { const k = shiftDay(dayKey(now), -i); trend.push({ day: k, registrations: perDay.get(k) || 0 }); }

  // Courses whose instructor can no longer teach (suspended or removed): ownership needs attention.
  const instructorIds = [...new Set(courseRows.map((c) => (c.instructorId ? String(c.instructorId) : null)).filter(isId))];
  const instructorState = await namesFor(db, instructorIds);
  const orphaned = courseRows.filter((c) => c.status !== 'archived' && (!c.instructorId || !instructorState.has(String(c.instructorId)) || instructorState.get(String(c.instructorId)).status !== 'active')).length;

  const metrics = {
    windowDays: d,
    students,
    activeStudents,
    activeLearners: new Set(learnerDays.map((r) => String(r.userId))).size,
    instructors,
    activeInstructors,
    admins,
    suspended,
    newRegistrations: newUsers.length,
    newStudents: newUsers.filter((u) => u.role === 'student').length,
    coursesByStatus: byStatus,
    enrollments: activeEnrollments.length,
    newEnrollments: activeEnrollments.filter((r) => time(r.enrolledAt || r.createdAt) >= since.getTime()).length,
    completions: activeEnrollments.filter((r) => time(r.completedAt) >= since.getTime()).length,
    coursesNeedingInstructor: orphaned,
  };

  const alerts = [];
  if (byStatus.in_review) alerts.push({ id: 'courses_in_review', severity: 'action', title: `${byStatus.in_review} course${byStatus.in_review === 1 ? '' : 's'} waiting for review`, href: '/admin/courses?status=in_review' });
  if (orphaned) alerts.push({ id: 'courses_without_instructor', severity: 'warning', title: `${orphaned} course${orphaned === 1 ? '' : 's'} without an active instructor`, href: '/admin/courses?attention=instructor' });

  let finance = null;
  let recentActions = null;
  if (isSuper(member)) {
    if (pending) alerts.unshift({ id: 'pending_approvals', severity: 'action', title: `${pending} account${pending === 1 ? '' : 's'} waiting for your approval`, href: '/admin?tab=approvals' });
    finance = await financeSummary(db, { since, now });
    if (finance.openExceptions) alerts.push({ id: 'payment_exceptions', severity: 'warning', title: `${finance.openExceptions} open payment exception${finance.openExceptions === 1 ? '' : 's'}`, href: '/admin/purchases' });
    if (finance.states.stalled) alerts.push({ id: 'stalled_confirmations', severity: 'warning', title: `${finance.states.stalled} payment confirmation${finance.states.stalled === 1 ? '' : 's'} stalled`, href: '/admin/reconciliation' });
    if (finance.held) alerts.push({ id: 'held_payments', severity: 'warning', title: `${finance.held} verified payment${finance.held === 1 ? '' : 's'} held for review`, href: '/admin/payments?state=held' });
    if (finance.refundsNeedingAttention) alerts.push({ id: 'refunds_attention', severity: 'warning', title: `${finance.refundsNeedingAttention} refund${finance.refundsNeedingAttention === 1 ? '' : 's'} uncertain or needing attention`, href: '/admin/refunds?status=open' });
    recentActions = (await db.collection(AUDIT_COLLECTION).find({}).sort({ createdAt: -1 }).limit(8).toArray()).map(presentAudit);
  }
  return {
    ok: true,
    role: member.role,
    metrics,
    trend,
    alerts,
    recentRegistrations: recentUsers.map((u) => ({ id: String(u._id), name: text(u.name, 'User'), role: u.role, status: accountStatusOf(u.status), createdAt: iso(u.createdAt) })),
    finance,
    recentActions,
  };
}

async function financeSummary(db, { since, now }) {
  const intents = db.collection(COLLECTIONS.intents);
  const [windowIntents, paidInWindow, refundsInWindow, openExceptions, held, refundsAttention, stalledNow] = await Promise.all([
    intents.find({ kind: 'course', createdAt: { $gte: since } }, { projection: { status: 1, claimedAt: 1, createdAt: 1, expiresAt: 1 } }).limit(100000).toArray(),
    intents.find({ kind: 'course', status: 'paid', paidAt: { $gte: since } }, { projection: { amountKobo: 1 } }).limit(100000).toArray(),
    db.collection(COLLECTIONS.refunds).find({ status: 'processed', updatedAt: { $gte: since } }, { projection: { amountKobo: 1 } }).limit(100000).toArray(),
    db.collection(COLLECTIONS.exceptions).countDocuments(openExceptionFilter),
    intents.countDocuments({ kind: 'course', status: 'held' }),
    db.collection(COLLECTIONS.refunds).countDocuments({ status: { $in: ['uncertain', 'needs_attention'] } }),
    intents.find({ kind: 'course', status: 'processing' }, { projection: { status: 1, claimedAt: 1 } }).limit(1000).toArray(),
  ]);
  const states = Object.fromEntries(['paid', 'held', 'confirming', 'stalled', 'pending', 'abandoned', 'closed'].map((s) => [s, 0]));
  for (const i of windowIntents) { const s = checkoutState(i, now); if (s in states) states[s] += 1; }
  states.stalled = stalledNow.filter((i) => checkoutState(i, now) === 'stalled').length;
  const gross = paidInWindow.reduce((s, i) => s + kobo(i.amountKobo), 0n);
  const refunds = refundsInWindow.reduce((s, r) => s + kobo(r.amountKobo), 0n);
  return {
    currency: COURSE_CURRENCY,
    paidCount: paidInWindow.length,
    gross: naira(gross),
    refunds: naira(refunds),
    refundCount: refundsInWindow.length,
    net: naira(gross - refunds),
    states,
    openExceptions,
    held,
    refundsNeedingAttention: refundsAttention,
  };
}

// ---------------------------------------------------------------------------
// Users and instructors
// ---------------------------------------------------------------------------

async function adminUsers(db, member, { q, role, status, page, limit } = {}) {
  const denied = guard(member);
  if (denied) return denied;
  const pg = paging(page, limit);
  const filter = {};
  if (['student', 'instructor', 'admin', 'superadmin'].includes(role)) filter.role = role;
  Object.assign(filter, accountStatusFilter(status));
  const rx = searchRegex(q);
  const query = rx ? { $and: [filter, { $or: [{ name: rx }, { email: rx }] }] } : filter;
  const users = db.collection('users');
  const [rows, total] = await Promise.all([
    users.find(query, { projection: { name: 1, email: 1, role: 1, status: 1, createdAt: 1, isExpert: 1 } }).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).toArray(),
    users.countDocuments(query),
  ]);
  const instructorIds = rows.filter((u) => u.role === 'instructor').map((u) => String(u._id));
  const owned = instructorIds.length
    ? await db.collection('courses').find({ instructorId: { $in: [...instructorIds, ...instructorIds.map(oid)] } }, { projection: { instructorId: 1 } }).toArray()
    : [];
  const courseCount = new Map();
  for (const c of owned) courseCount.set(String(c.instructorId), (courseCount.get(String(c.instructorId)) || 0) + 1);
  return {
    ok: true,
    rows: rows.map((u) => ({
      id: String(u._id),
      name: text(u.name),
      email: text(u.email),
      role: text(u.role),
      status: accountStatusOf(u.status),
      createdAt: iso(u.createdAt),
      isExpert: u.isExpert === true,
      courses: u.role === 'instructor' ? courseCount.get(String(u._id)) || 0 : null,
    })),
    pagination: pageInfo(pg, total),
    canDecideApprovals: isSuper(member),
    canChangeStatus: isSuper(member),
  };
}

async function adminUserDetail(db, member, { userId, now = new Date() } = {}) {
  const denied = guard(member);
  if (denied) return denied;
  if (!isId(userId)) return refuse(404, 'User not found');
  const superAdmin = isSuper(member);
  const user = await db.collection('users').findOne({ _id: oid(userId) }, { projection: { name: 1, email: 1, role: 1, status: 1, createdAt: 1, updatedAt: 1, learningLevel: 1, isExpert: 1, statusReason: 1, statusChangedAt: 1, ...(superAdmin ? { phone: 1 } : {}) } });
  if (!user) return refuse(404, 'User not found');
  const uid = String(user._id);
  const [rows, days, sessions, owned] = await Promise.all([
    db.collection('progress').find({ userId: uid }, { projection: { courseId: 1, progress: 1, completedAt: 1, enrolledAt: 1, createdAt: 1, withdrawnAt: 1, active: 1, lastActivityAt: 1 } }).limit(200).toArray(),
    db.collection('learningDays').find({ userId: uid }, { projection: { day: 1, minutes: 1 } }).sort({ day: -1 }).limit(3660).toArray(),
    db.collection('sessions').countDocuments({ userId: uid, revokedAt: null, absoluteExpiresAt: { $gt: now } }),
    user.role === 'instructor' ? db.collection('courses').find({ instructorId: { $in: [uid, oid(uid)] } }, { projection: { title: 1, status: 1, updatedAt: 1 } }).limit(200).toArray() : [],
  ]);
  const titles = await courseTitles(db, rows.map((r) => r.courseId));
  const access = rows.length ? await db.collection(COLLECTIONS.courseAccess).find({ userId: uid }, { projection: { courseId: 1, entitlementType: 1, paid: 1, paystackReference: 1, unlockedAt: 1, revokedAt: 1, refundedAt: 1 } }).toArray() : [];
  const accessByCourse = new Map(access.map((a) => [String(a.courseId), a]));
  let payments = null;
  let history = null;
  if (superAdmin) {
    const intents = await db.collection(COLLECTIONS.intents).find({ userId: uid, kind: 'course' }, { projection: { reference: 1, courseId: 1, status: 1, amountKobo: 1, createdAt: 1, paidAt: 1, claimedAt: 1, expiresAt: 1 } }).sort({ createdAt: -1 }).limit(50).toArray();
    const sums = await refundSummaries(db, intents.map((i) => i.reference));
    const ptitles = await courseTitles(db, intents.map((i) => i.courseId));
    payments = intents.map((i) => ({ reference: String(i.reference), course: (ptitles.get(String(i.courseId)) || {}).title || 'Course', amount: naira(kobo(i.amountKobo)), state: checkoutState(i, now), refund: refundStateOf(i, sums.get(String(i.reference))), createdAt: iso(i.createdAt), paidAt: iso(i.paidAt) }));
    history = (await db.collection(AUDIT_COLLECTION).find({ entityType: 'account', entityId: uid }).sort({ createdAt: -1 }).limit(30).toArray()).map(presentAudit);
  }
  return {
    ok: true,
    user: {
      id: uid,
      name: text(user.name),
      email: text(user.email),
      ...(superAdmin ? { phone: text(user.phone) || null } : {}),
      role: text(user.role),
      status: accountStatusOf(user.status),
      statusReason: superAdmin ? text(user.statusReason) || null : null,
      learningLevel: user.learningLevel || null,
      isExpert: user.isExpert === true,
      createdAt: iso(user.createdAt),
      activeSessions: sessions,
    },
    learning: {
      totalMinutes: days.reduce((s, r) => s + (typeof r.minutes === 'number' ? r.minutes : 0), 0),
      lastLearningDay: days[0] ? days[0].day : null,
      learningDays: days.length,
    },
    enrollments: rows.map((r) => {
      const a = accessByCourse.get(String(r.courseId));
      return {
        courseId: String(r.courseId),
        course: (titles.get(String(r.courseId)) || {}).title || 'Course',
        status: isActiveEnrollment(r) ? 'active' : 'withdrawn',
        progress: typeof r.progress === 'number' ? Math.min(100, Math.max(0, r.progress)) : 0,
        enrolledAt: iso(r.enrolledAt || r.createdAt),
        completedAt: iso(r.completedAt),
        lastActivityAt: iso(r.lastActivityAt),
        access: a ? { type: a.entitlementType || (a.paid ? 'paid_course' : null), entitled: isEntitledRow(a), ...(superAdmin ? { reference: a.paystackReference ? String(a.paystackReference) : null } : {}) } : null,
      };
    }),
    courses: owned.map((c) => ({ courseId: String(c._id), title: text(c.title, 'Course'), status: c.status || 'published', updatedAt: iso(c.updatedAt) })),
    payments,
    history,
    permissions: { canChangeStatus: superAdmin, canDecideApproval: superAdmin && user.status === 'pending', canGrantAccess: superAdmin },
  };
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

async function adminCourses(db, member, { q, status, instructorId, attention, page, limit } = {}) {
  const denied = guard(member);
  if (denied) return denied;
  const pg = paging(page, limit);
  const filter = {};
  if (status === 'published') filter.$or = [{ status: 'published' }, { status: { $exists: false } }];
  else if (COURSE_STATUSES.includes(status)) filter.status = status;
  if (isId(instructorId)) filter.instructorId = { $in: [instructorId, oid(instructorId)] };
  const rx = searchRegex(q);
  if (rx) filter.title = rx;
  const courses = db.collection('courses');
  let rows;
  let total;
  if (attention === 'instructor') {
    // Courses without an active instructor (bounded scan of the course list).
    const all = await courses.find({ ...filter, status: { $ne: 'archived' } }, { projection: { title: 1, status: 1, instructorId: 1, difficulty: 1, createdAt: 1, updatedAt: 1, instructorHistory: 1 } }).limit(5000).toArray();
    const people = await namesFor(db, all.map((c) => (c.instructorId ? String(c.instructorId) : '')));
    const flagged = all.filter((c) => !c.instructorId || !people.has(String(c.instructorId)) || people.get(String(c.instructorId)).status !== 'active');
    total = flagged.length;
    rows = flagged.slice(pg.skip, pg.skip + pg.limit);
  } else {
    [rows, total] = await Promise.all([
      courses.find(filter, { projection: { title: 1, status: 1, instructorId: 1, difficulty: 1, createdAt: 1, updatedAt: 1, instructorHistory: 1 } }).sort({ updatedAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).toArray(),
      courses.countDocuments(filter),
    ]);
  }
  const ids = rows.map((c) => String(c._id));
  const [people, lessons, enroll] = await Promise.all([
    namesFor(db, rows.map((c) => (c.instructorId ? String(c.instructorId) : ''))),
    ids.length ? db.collection('lessons').find({ courseId: { $in: ids } }, { projection: { courseId: 1 } }).toArray() : [],
    ids.length ? db.collection('progress').find({ courseId: { $in: [...ids, ...ids.map(oid)] } }, { projection: { courseId: 1, withdrawnAt: 1, active: 1, completedAt: 1 } }).toArray() : [],
  ]);
  const count = (list, key) => { const m = new Map(); for (const r of list) { const k = String(r[key]); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const lessonCount = count(lessons, 'courseId');
  const active = enroll.filter(isActiveEnrollment);
  const enrollCount = count(active, 'courseId');
  const doneCount = count(active.filter((r) => r.completedAt), 'courseId');
  return {
    ok: true,
    rows: rows.map((c) => {
      const id = String(c._id);
      const person = c.instructorId ? people.get(String(c.instructorId)) : null;
      const n = enrollCount.get(id) || 0;
      return {
        courseId: id,
        title: text(c.title, 'Course'),
        status: c.status === undefined ? 'published' : c.status,
        difficulty: c.difficulty || null,
        instructor: person ? { id: String(c.instructorId), name: person.name, status: person.status } : null,
        instructorNeedsAttention: !person || person.status !== 'active',
        lessons: lessonCount.get(id) || 0,
        enrollments: n,
        completionRate: n ? round1(((doneCount.get(id) || 0) / n) * 100) : null,
        reassignments: Array.isArray(c.instructorHistory) ? c.instructorHistory.length : 0,
        createdAt: iso(c.createdAt),
        updatedAt: iso(c.updatedAt),
      };
    }),
    pagination: pageInfo(pg, total),
  };
}

// ---------------------------------------------------------------------------
// Enrollments and entitlements
// ---------------------------------------------------------------------------

/**
 * Enrollment rows with their course entitlement. access: 'paid' (paid_course entitlement),
 * 'granted' (complimentary or manual grant), or any. Payment references for the Super Admin only.
 * This view changes nothing: grants and revocations stay with /api/admin/course-access (Super
 * Admin, reasoned, audited) and paid access ends only through a refund.
 */
async function adminEnrollments(db, member, { q, courseId, status, access, page, limit } = {}) {
  const denied = guard(member);
  if (denied) return denied;
  const superAdmin = isSuper(member);
  const pg = paging(page, limit);
  const filter = {};
  if (isId(courseId)) filter.courseId = { $in: [courseId, oid(courseId)] };
  if (status === 'active') Object.assign(filter, { withdrawnAt: { $in: [null, ''] }, active: { $ne: false } });
  if (status === 'withdrawn') filter.$or = [{ withdrawnAt: { $nin: [null, ''] } }, { active: false }];
  const rx = searchRegex(q);
  if (rx) {
    const matches = await db.collection('users').find({ $or: [{ name: rx }, { email: rx }] }, { projection: { _id: 1 } }).limit(500).toArray();
    filter.userId = { $in: matches.map((u) => String(u._id)) };
  }
  if (access === 'paid' || access === 'granted') {
    const accessFilter = access === 'paid' ? { entitlementType: 'paid_course', paid: true } : { entitlementType: { $in: ['complimentary', 'manual_grant'] } };
    const pairs = await db.collection(COLLECTIONS.courseAccess).find(accessFilter, { projection: { userId: 1, courseId: 1, revokedAt: 1 } }).limit(5000).toArray();
    const allowed = pairs.map((p) => ({ userId: String(p.userId), courseId: { $in: [String(p.courseId), ...(isId(String(p.courseId)) ? [oid(String(p.courseId))] : [])] } }));
    if (!allowed.length) return { ok: true, rows: [], pagination: pageInfo(pg, 0) };
    filter.$and = [...(filter.$and || []), { $or: allowed }];
  }
  const progress = db.collection('progress');
  const [rows, total] = await Promise.all([
    progress.find(filter, { projection: { userId: 1, courseId: 1, progress: 1, completedAt: 1, enrolledAt: 1, createdAt: 1, withdrawnAt: 1, active: 1, lastActivityAt: 1 } }).sort({ enrolledAt: -1, createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).toArray(),
    progress.countDocuments(filter),
  ]);
  const [people, titles, accessRows] = await Promise.all([
    namesFor(db, rows.map((r) => String(r.userId)), { withEmail: superAdmin }),
    courseTitles(db, rows.map((r) => r.courseId)),
    rows.length ? db.collection(COLLECTIONS.courseAccess).find({ userId: { $in: [...new Set(rows.map((r) => String(r.userId)))] } }, { projection: { userId: 1, courseId: 1, entitlementType: 1, paid: 1, paystackReference: 1, unlockedAt: 1, revokedAt: 1 } }).toArray() : [],
  ]);
  const accessBy = new Map(accessRows.map((a) => [`${a.userId}|${a.courseId}`, a]));
  return {
    ok: true,
    rows: rows.map((r) => {
      const p = people.get(String(r.userId));
      const a = accessBy.get(`${r.userId}|${String(r.courseId)}`);
      return {
        id: String(r._id),
        studentId: String(r.userId),
        student: p ? p.name : 'User',
        ...(superAdmin ? { email: p ? p.email || '' : '' } : {}),
        courseId: String(r.courseId),
        course: (titles.get(String(r.courseId)) || {}).title || 'Course',
        status: isActiveEnrollment(r) ? 'active' : 'withdrawn',
        progress: typeof r.progress === 'number' ? Math.min(100, Math.max(0, r.progress)) : 0,
        enrolledAt: iso(r.enrolledAt || r.createdAt),
        completedAt: iso(r.completedAt),
        withdrawnAt: iso(r.withdrawnAt),
        access: a ? { type: a.entitlementType || (a.paid ? 'paid_course' : null), entitled: isEntitledRow(a), unlockedAt: iso(a.unlockedAt), ...(superAdmin ? { reference: a.paystackReference ? String(a.paystackReference) : null } : {}) } : null,
      };
    }),
    pagination: pageInfo(pg, total),
    canGrant: superAdmin,
  };
}

// ---------------------------------------------------------------------------
// Payments and refunds (Super Admin)
// ---------------------------------------------------------------------------

function dateRange(from, to) {
  const f = typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00.000Z`) : null;
  const t = typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59.999Z`) : null;
  return { from: f && !Number.isNaN(f.getTime()) ? f : null, to: t && !Number.isNaN(t.getTime()) ? t : null };
}

async function adminPayments(db, member, { state, from, to, q, courseId, page, limit, now = new Date() } = {}) {
  const denied = guard(member, { superOnly: true });
  if (denied) return denied;
  const pg = paging(page, limit);
  const filter = { kind: 'course' };
  const range = dateRange(from, to);
  if (range.from || range.to) filter.createdAt = { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) };
  if (isId(courseId)) filter.courseId = courseId;
  const cutoff = new Date(now.getTime() - ABANDON_AFTER_MS);
  const claimCut = new Date(now.getTime() - CLAIM_TTL_MS);
  if (state === 'paid') filter.status = 'paid';
  else if (state === 'held') filter.status = 'held';
  else if (state === 'confirming') Object.assign(filter, { status: 'processing', claimedAt: { $gte: claimCut } });
  else if (state === 'stalled') Object.assign(filter, { status: 'processing', claimedAt: { $lt: claimCut } });
  else if (state === 'pending') Object.assign(filter, { status: 'pending', createdAt: { ...(filter.createdAt || {}), $gte: range.from && range.from > cutoff ? range.from : cutoff }, expiresAt: { $gte: now } });
  else if (state === 'abandoned') filter.$and = [{ status: 'pending' }, { $or: [{ createdAt: { $lt: cutoff } }, { expiresAt: { $lt: now } }] }];
  else if (state === 'closed') filter.status = { $in: ['expired', 'superseded'] };
  else if (state === 'refunded') {
    const refunded = await db.collection(COLLECTIONS.refunds).find({ status: 'processed' }, { projection: { paymentReference: 1 } }).limit(20000).toArray();
    Object.assign(filter, { status: 'paid', reference: { $in: [...new Set(refunded.map((r) => String(r.paymentReference)))] } });
  }
  const term = typeof q === 'string' ? q.trim().slice(0, 80) : '';
  if (term) {
    if (term.includes('@')) {
      const users = await db.collection('users').find({ email: new RegExp(`^${escapeRegex(term)}`, 'i') }, { projection: { _id: 1 } }).limit(50).toArray();
      filter.userId = { $in: users.map((u) => String(u._id)) };
    } else {
      filter.reference = new RegExp(`^${escapeRegex(term)}`, 'i');
    }
  }
  const intents = db.collection(COLLECTIONS.intents);
  const [rows, total] = await Promise.all([
    intents.find(filter, { projection: { reference: 1, userId: 1, courseId: 1, status: 1, amountKobo: 1, currency: 1, createdAt: 1, paidAt: 1, claimedAt: 1, expiresAt: 1, heldReason: 1 } }).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).toArray(),
    intents.countDocuments(filter),
  ]);
  const [people, titles, sums] = await Promise.all([
    namesFor(db, rows.map((r) => String(r.userId)), { withEmail: true }),
    courseTitles(db, rows.map((r) => r.courseId)),
    refundSummaries(db, rows.map((r) => r.reference)),
  ]);
  return {
    ok: true,
    rows: rows.map((r) => {
      const p = people.get(String(r.userId));
      const s = sums.get(String(r.reference));
      return {
        reference: String(r.reference),
        student: p ? p.name : 'User',
        email: p ? p.email || '' : '',
        studentId: String(r.userId),
        course: (titles.get(String(r.courseId)) || {}).title || 'Course',
        courseId: String(r.courseId),
        amount: naira(kobo(r.amountKobo)),
        currency: r.currency || COURSE_CURRENCY,
        state: checkoutState(r, now),
        refund: refundStateOf(r, s),
        refunded: s ? naira(s.processed) : '0.00',
        heldReason: r.heldReason || null,
        createdAt: iso(r.createdAt),
        paidAt: iso(r.paidAt),
      };
    }),
    pagination: pageInfo(pg, total),
  };
}

const REFUND_STATUS_GROUPS = Object.freeze({ open: [...REFUND_OPEN], processed: ['processed'], failed: ['failed', 'request_failed'] });

async function adminRefunds(db, member, { status, page, limit } = {}) {
  const denied = guard(member, { superOnly: true });
  if (denied) return denied;
  const pg = paging(page, limit);
  const filter = REFUND_STATUS_GROUPS[status] ? { status: { $in: REFUND_STATUS_GROUPS[status] } } : {};
  const col = db.collection(COLLECTIONS.refunds);
  const [rows, total, counts] = await Promise.all([
    col.find(filter, { projection: { paymentReference: 1, userId: 1, courseId: 1, amountKobo: 1, status: 1, full: 1, revokeAccess: 1, reason: 1, requestedAt: 1, updatedAt: 1, providerRefundId: 1, requestedBy: 1 } }).sort({ requestedAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).toArray(),
    col.countDocuments(filter),
    Promise.all(Object.entries(REFUND_STATUS_GROUPS).map(async ([k, v]) => [k, await col.countDocuments({ status: { $in: v } })])),
  ]);
  const [people, titles] = await Promise.all([namesFor(db, rows.map((r) => String(r.userId))), courseTitles(db, rows.map((r) => r.courseId))]);
  return {
    ok: true,
    rows: rows.map((r) => ({
      id: String(r._id),
      reference: String(r.paymentReference),
      student: (people.get(String(r.userId)) || {}).name || 'User',
      course: (titles.get(String(r.courseId)) || {}).title || 'Course',
      amount: naira(kobo(r.amountKobo)),
      status: r.status,
      full: r.full === true,
      revokeAccess: r.revokeAccess === true,
      reason: text(r.reason),
      providerRefundId: r.providerRefundId ? String(r.providerRefundId) : null,
      requestedBy: r.requestedBy && r.requestedBy.email ? r.requestedBy.email : null,
      requestedAt: iso(r.requestedAt),
      updatedAt: iso(r.updatedAt),
    })),
    counts: Object.fromEntries(counts),
    pagination: pageInfo(pg, total),
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * Daily figures between `from` and `to` (Africa/Lagos days, at most 366): registrations,
 * enrollments, completions, learning minutes and active learners; for the Super Admin also gross
 * payments (paid checkouts by paidAt), processed refunds (by updatedAt), net, checkout status
 * distribution and grading activity by instructor.
 */
async function adminReport(db, member, { from, to, now = new Date() } = {}) {
  const denied = guard(member);
  if (denied) return denied;
  const r = dateRange(from, to);
  const end = r.to || now;
  let start = r.from || new Date(end.getTime() - 29 * DAY_MS);
  if (end.getTime() - start.getTime() > 366 * DAY_MS) start = new Date(end.getTime() - 366 * DAY_MS);
  if (start > end) return refuse(400, 'The start date must be before the end date.');
  const startDay = dayKey(start);
  const endDay = dayKey(end);
  const days = [];
  for (let k = startDay; k <= endDay; k = shiftDay(k, 1)) days.push(k);
  const bucket = () => new Map(days.map((k) => [k, 0]));
  const add = (m, date, n = 1) => { if (!date) return; const k = dayKey(new Date(date)); if (m.has(k)) m.set(k, m.get(k) + n); };
  const inRange = { $gte: start, $lte: end };
  const [newUsers, enrolls, completions, learning] = await Promise.all([
    db.collection('users').find({ createdAt: inRange }, { projection: { createdAt: 1, role: 1 } }).limit(100000).toArray(),
    db.collection('progress').find({ $or: [{ enrolledAt: inRange }, { createdAt: inRange }] }, { projection: { enrolledAt: 1, createdAt: 1, courseId: 1 } }).limit(200000).toArray(),
    db.collection('progress').find({ completedAt: inRange }, { projection: { completedAt: 1, courseId: 1 } }).limit(200000).toArray(),
    db.collection('learningDays').find({ day: { $gte: startDay, $lte: endDay } }, { projection: { day: 1, minutes: 1, userId: 1 } }).limit(500000).toArray(),
  ]);
  const reg = bucket(); const enr = bucket(); const comp = bucket(); const mins = bucket(); const learners = new Map(days.map((k) => [k, new Set()]));
  for (const u of newUsers) add(reg, u.createdAt);
  for (const e of enrolls) add(enr, e.enrolledAt || e.createdAt);
  for (const c of completions) add(comp, c.completedAt);
  for (const l of learning) { if (mins.has(l.day)) { mins.set(l.day, mins.get(l.day) + (typeof l.minutes === 'number' ? l.minutes : 0)); learners.get(l.day).add(String(l.userId)); } }

  // Top courses by enrollments in the range.
  const perCourse = new Map();
  for (const e of enrolls) { const k = String(e.courseId); const v = perCourse.get(k) || { enrollments: 0, completions: 0 }; v.enrollments += 1; perCourse.set(k, v); }
  for (const c of completions) { const k = String(c.courseId); const v = perCourse.get(k) || { enrollments: 0, completions: 0 }; v.completions += 1; perCourse.set(k, v); }
  const topIds = [...perCourse.entries()].sort((a, b) => b[1].enrollments - a[1].enrollments).slice(0, 10);
  const titles = await courseTitles(db, topIds.map(([k]) => k));

  const report = {
    ok: true,
    range: { from: startDay, to: endDay, days: days.length, timezone: 'Africa/Lagos' },
    totals: {
      registrations: newUsers.length,
      studentRegistrations: newUsers.filter((u) => u.role === 'student').length,
      enrollments: enrolls.length,
      completions: completions.length,
      learningMinutes: [...mins.values()].reduce((a, b) => a + b, 0),
      activeLearners: new Set(learning.map((l) => String(l.userId))).size,
    },
    daily: days.map((k) => ({ day: k, registrations: reg.get(k), enrollments: enr.get(k), completions: comp.get(k), learningMinutes: mins.get(k), activeLearners: learners.get(k).size })),
    topCourses: topIds.map(([k, v]) => ({ courseId: k, title: (titles.get(k) || {}).title || 'Course', enrollments: v.enrollments, completions: v.completions })),
    finance: null,
    grading: null,
  };
  if (isSuper(member)) {
    const [paid, created, refunds, grades] = await Promise.all([
      db.collection(COLLECTIONS.intents).find({ kind: 'course', status: 'paid', paidAt: inRange }, { projection: { paidAt: 1, amountKobo: 1 } }).limit(200000).toArray(),
      db.collection(COLLECTIONS.intents).find({ kind: 'course', createdAt: inRange }, { projection: { status: 1, claimedAt: 1, createdAt: 1, expiresAt: 1 } }).limit(200000).toArray(),
      db.collection(COLLECTIONS.refunds).find({ status: 'processed', updatedAt: inRange }, { projection: { updatedAt: 1, amountKobo: 1 } }).limit(200000).toArray(),
      db.collection(AUDIT_COLLECTION).find({ entityType: 'grade', createdAt: inRange }, { projection: { actor: 1, action: 1 } }).limit(200000).toArray(),
    ]);
    const gross = new Map(days.map((k) => [k, 0n]));
    const ref = new Map(days.map((k) => [k, 0n]));
    for (const p of paid) { const k = dayKey(new Date(p.paidAt)); if (gross.has(k)) gross.set(k, gross.get(k) + kobo(p.amountKobo)); }
    for (const x of refunds) { const k = dayKey(new Date(x.updatedAt)); if (ref.has(k)) ref.set(k, ref.get(k) + kobo(x.amountKobo)); }
    const states = {};
    for (const c of created) { const s = checkoutState(c, now); states[s] = (states[s] || 0) + 1; }
    const g = [...gross.values()].reduce((a, b) => a + b, 0n);
    const rf = [...ref.values()].reduce((a, b) => a + b, 0n);
    report.finance = {
      currency: COURSE_CURRENCY,
      gross: naira(g),
      refunds: naira(rf),
      net: naira(g - rf),
      paidCount: paid.length,
      refundCount: refunds.length,
      statusDistribution: states,
      daily: days.map((k) => ({ day: k, gross: naira(gross.get(k)), refunds: naira(ref.get(k)), net: naira(gross.get(k) - ref.get(k)) })),
    };
    const byActor = new Map();
    for (const e of grades) { const k = e.actor && e.actor.userId ? String(e.actor.userId) : 'unknown'; const v = byActor.get(k) || { graded: 0, regraded: 0 }; if (e.action === 'assignment_regraded') v.regraded += 1; else v.graded += 1; byActor.set(k, v); }
    const people = await namesFor(db, [...byActor.keys()]);
    report.grading = [...byActor.entries()].map(([k, v]) => ({ userId: k, name: (people.get(k) || {}).name || 'Unknown', ...v })).sort((a, b) => b.graded + b.regraded - (a.graded + a.regraded));
  }
  return report;
}

// ---------------------------------------------------------------------------
// Platform configuration (read-only)
// ---------------------------------------------------------------------------

/**
 * What is configured, never the values of secrets. Nothing here is editable: these are deploy-time
 * settings (environment variables), changed by redeploying, never from the browser.
 */
function platformConfig(member, env = process.env) {
  const denied = guard(member);
  if (denied) return denied;
  const set = (name) => Boolean(String(env[name] || '').trim());
  const payments = decidePaymentEnvironment(env);
  return {
    ok: true,
    editable: false,
    environment: env.NODE_ENV === 'production' ? 'production' : 'non-production',
    integrations: [
      { id: 'payments', label: 'Paystack payments', state: payments.enabled ? `enabled (${payments.mode || 'live'})` : 'disabled', detail: payments.enabled ? null : payments.reason || null },
      { id: 'email', label: 'Transactional email (Resend)', state: set('RESEND_API_KEY') ? 'configured' : 'not configured' },
      { id: 'media', label: 'Media storage (Cloudinary)', state: set('CLOUDINARY_CLOUD_NAME') && set('CLOUDINARY_API_KEY') && set('CLOUDINARY_API_SECRET') ? 'configured' : 'not configured' },
      { id: 'ai', label: 'AI assistant', state: set('OPENAI_API_KEY') || set('AI_API_KEY') ? 'configured' : 'not configured' },
      { id: 'ads', label: 'Advertising', state: env.NEXT_PUBLIC_ADS_ENABLED === 'false' ? 'disabled' : 'enabled' },
    ],
    platform: [
      { label: 'Course price', value: `${COURSE_CURRENCY} ${naira(BigInt(COURSE_PRICE_KOBO))}` },
      { label: 'Account approval', value: 'Instructors and admins need Super Admin approval; students are approved at signup' },
      { label: 'Practice market', value: 'Simulated (never live market data)' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Audit presentation
// ---------------------------------------------------------------------------

function presentAudit(e) {
  return {
    id: String(e._id),
    action: text(e.action),
    entityType: text(e.entityType),
    entityId: e.entityId == null ? null : String(e.entityId),
    reference: e.reference == null ? null : String(e.reference),
    reason: text(e.reason) || null,
    outcome: text(e.outcome) || null,
    actor: e.actor ? { userId: e.actor.userId ? String(e.actor.userId) : null, email: e.actor.email || null, role: e.actor.role || null } : null,
    before: e.before || null,
    after: e.after || null,
    createdAt: iso(e.createdAt),
  };
}

// ---------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------

/**
 * One CSV cell. Cells that a spreadsheet would evaluate (starting with = + - @, a tab or a carriage
 * return) are prefixed with an apostrophe so they stay text; quotes are doubled; cells with a
 * comma, quote or line break are quoted.
 */
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvLine = (cells) => cells.map(csvCell).join(',');

/** Pages through a list function for an export, at most EXPORT_MAX_ROWS rows. */
async function collect(fn, filters) {
  const out = [];
  let page = 1;
  let truncated = false;
  for (;;) {
    const r = await fn({ ...filters, page, limit: MAX_PAGE_SIZE });
    if (!r.ok) return r;
    out.push(...r.rows);
    if (out.length >= EXPORT_MAX_ROWS) { truncated = r.pagination.total > EXPORT_MAX_ROWS; break; }
    if (page >= r.pagination.pages) break;
    page += 1;
  }
  return { ok: true, rows: out.slice(0, EXPORT_MAX_ROWS), truncated };
}

/**
 * Builds a CSV for `type` with the same filters as the screen, after the role check for that type,
 * and writes an audit entry (type, filters, rows, actor). Returns { ok, filename, csv, rows }.
 */
async function buildExport(db, member, { type, filters = {}, now = new Date() } = {}) {
  const denied = guard(member);
  if (denied) return denied;
  const need = EXPORT_TYPES[type];
  if (!need) return refuse(400, 'Unknown export.');
  if (need === 'superadmin' && !isSuper(member)) return refuse(403, 'Only the Super Admin can export this.');
  const f = { ...filters };
  let header;
  let lines;
  let truncated = false;
  if (type === 'users') {
    const r = await collect((o) => adminUsers(db, member, o), f);
    if (!r.ok) return r;
    truncated = r.truncated;
    header = ['id', 'name', 'email', 'role', 'status', 'created_at'];
    lines = r.rows.map((u) => [u.id, u.name, u.email, u.role, u.status, u.createdAt]);
  } else if (type === 'courses') {
    const r = await collect((o) => adminCourses(db, member, o), f);
    if (!r.ok) return r;
    truncated = r.truncated;
    header = ['course_id', 'title', 'status', 'instructor', 'instructor_status', 'lessons', 'active_enrollments', 'completion_rate_percent', 'created_at', 'updated_at'];
    lines = r.rows.map((c) => [c.courseId, c.title, c.status, c.instructor ? c.instructor.name : '', c.instructor ? c.instructor.status : 'none', c.lessons, c.enrollments, c.completionRate ?? '', c.createdAt, c.updatedAt]);
  } else if (type === 'enrollments') {
    const r = await collect((o) => adminEnrollments(db, member, o), f);
    if (!r.ok) return r;
    truncated = r.truncated;
    const superAdmin = isSuper(member);
    header = ['student', ...(superAdmin ? ['email'] : []), 'course', 'status', 'progress_percent', 'enrolled_at', 'completed_at', 'access_type', 'entitled', ...(superAdmin ? ['payment_reference'] : [])];
    lines = r.rows.map((e) => [e.student, ...(superAdmin ? [e.email] : []), e.course, e.status, e.progress, e.enrolledAt, e.completedAt, e.access ? e.access.type : '', e.access ? (e.access.entitled ? 'yes' : 'no') : 'no', ...(superAdmin ? [e.access && e.access.reference ? e.access.reference : ''] : [])]);
  } else if (type === 'payments') {
    const r = await collect((o) => adminPayments(db, member, { ...o, now }), f);
    if (!r.ok) return r;
    truncated = r.truncated;
    header = ['reference', 'student', 'email', 'course', 'amount_ngn', 'state', 'refund', 'refunded_ngn', 'created_at', 'paid_at'];
    lines = r.rows.map((p) => [p.reference, p.student, p.email, p.course, p.amount, p.state, p.refund || '', p.refunded, p.createdAt, p.paidAt]);
  } else if (type === 'refunds') {
    const r = await collect((o) => adminRefunds(db, member, o), f);
    if (!r.ok) return r;
    truncated = r.truncated;
    header = ['refund_id', 'payment_reference', 'student', 'course', 'amount_ngn', 'status', 'full', 'revoke_access', 'reason', 'requested_by', 'requested_at', 'updated_at'];
    lines = r.rows.map((x) => [x.id, x.reference, x.student, x.course, x.amount, x.status, x.full ? 'yes' : 'no', x.revokeAccess ? 'yes' : 'no', x.reason, x.requestedBy || '', x.requestedAt, x.updatedAt]);
  } else {
    const r = await collect((o) => auditPage(db, o), f);
    if (!r.ok) return r;
    truncated = r.truncated;
    header = ['time', 'actor_email', 'actor_role', 'action', 'entity_type', 'entity_id', 'reference', 'reason', 'outcome'];
    lines = r.rows.map((a) => [a.createdAt, a.actor ? a.actor.email || a.actor.userId : '', a.actor ? a.actor.role || '' : '', a.action, a.entityType, a.entityId || '', a.reference || '', a.reason || '', a.outcome || '']);
  }
  const csv = `${[csvLine(header), ...lines.map(csvLine)].join('\r\n')}\r\n`;
  const safeFilters = Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => [k, v.slice(0, 80)]));
  try {
    await db.collection(AUDIT_COLLECTION).insertOne({
      entityType: 'export',
      entityId: type,
      reference: null,
      action: 'data_exported',
      reason: '',
      before: null,
      after: { type, rows: lines.length, truncated, filters: safeFilters },
      outcome: 'saved',
      actor: { userId: String(member.userId), email: member.email || null, role: member.role },
      createdAt: now,
    });
  } catch {
    // An export that cannot be accounted for is not handed out.
    return refuse(500, 'The export could not be recorded in the audit log, so it was not created.');
  }
  return { ok: true, filename: `forexorbit-${type}-${now.toISOString().slice(0, 10)}.csv`, csv, rows: lines.length, truncated };
}

/** Audit entries with filters, for the viewer and the export (Super Admin; the route checks). */
const AUDIT_TYPES = Object.freeze(['purchase', 'payment_exception', 'account', 'course_access', 'grade', 'course', 'export', 'reconciliation', 'refund']);
async function auditPage(db, { entityType, action, actor, from, to, q, page, limit } = {}) {
  const pg = paging(page, limit);
  const filter = {};
  if (AUDIT_TYPES.includes(entityType)) filter.entityType = entityType;
  if (typeof action === 'string' && /^[a-z_]{2,60}$/.test(action)) filter.action = action;
  if (typeof actor === 'string' && actor.trim()) filter['actor.email'] = new RegExp(`^${escapeRegex(actor.trim().slice(0, 80))}`, 'i');
  const range = dateRange(from, to);
  if (range.from || range.to) filter.createdAt = { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) };
  if (typeof q === 'string' && q.trim()) {
    const rx = new RegExp(`^${escapeRegex(q.trim().slice(0, 80))}`, 'i');
    filter.$or = [{ reference: rx }, { entityId: rx }];
  }
  const col = db.collection(AUDIT_COLLECTION);
  const [rows, total] = await Promise.all([
    col.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).toArray(),
    col.countDocuments(filter),
  ]);
  return { ok: true, rows: rows.map(presentAudit), pagination: pageInfo(pg, total) };
}

module.exports = {
  ABANDON_AFTER_MS,
  ACCOUNT_STATUSES,
  AUDIT_TYPES,
  EXPORT_MAX_ROWS,
  EXPORT_TYPES,
  PAYMENT_STATES,
  adminCourses,
  adminEnrollments,
  adminOverview,
  adminPayments,
  adminRefunds,
  adminReport,
  adminUserDetail,
  adminUsers,
  auditPage,
  buildExport,
  checkoutState,
  csvCell,
  kobo,
  naira,
  platformConfig,
  presentAudit,
};
