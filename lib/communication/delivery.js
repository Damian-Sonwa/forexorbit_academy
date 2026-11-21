'use strict';

/**
 * Communication delivery (Phase 14): one event contract, channel planning, the email and push
 * queue, retries and provider feedback.
 *
 * The event is the per-recipient notification document (collection `notifications`, already the
 * authoritative record with a dedupe key per recipient). Phase 14 adds to it:
 *   category            from lib/communication/preferences.js
 *   inApp               false when the user turned in-app off for an optional category (the
 *                       document is kept for its other channels and hidden from the list)
 *   channels.email      { state, attempts, nextAttemptAt, leaseUntil, providerId, lastError,
 *                         events[], updatedAt }
 *   channels.push       { state, attempts, nextAttemptAt, sent, failed, lastError, updatedAt }
 * No collection is added, so the database role is unchanged.
 *
 * Email states: queued -> sending -> sent (provider accepted) -> delivered (provider evidence)
 *   or retrying (transient failure, exponential backoff) -> failed (terminal after MAX_ATTEMPTS,
 *   or a permanent provider error), bounced / complained (webhook; the address is suppressed),
 *   suppressed (address suppressed, account inactive or preference turned off before sending),
 *   skipped (no address). "Sent" means the provider accepted the message, never that it arrived.
 *
 * Idempotency: the provider idempotency key is `notification:<id>`, so a retry after a timeout or
 * a crashed worker cannot send a second email; the dedupe key on the notification stops a second
 * document; a claim is a conditional update on the state, so two workers never send the same one.
 */

const { ObjectId } = require('mongodb');
const P = require('./preferences');

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = Object.freeze([60e3, 5 * 60e3, 25 * 60e3, 2 * 3600e3, 6 * 3600e3]);
const LEASE_MS = 2 * 60e3;
const BATCH = 25;
const EVENT_LOG = 20;
const EMAIL_STATES = Object.freeze(['queued', 'sending', 'sent', 'delivered', 'retrying', 'failed', 'bounced', 'complained', 'suppressed', 'skipped']);
const RANK = { queued: 0, retrying: 0, sending: 1, sent: 2, delivered: 3, failed: 4, bounced: 4, complained: 4, suppressed: 4, skipped: 4 };
const PERMANENT_ERRORS = new Set(['validation_error', 'invalid_to_address', 'invalid_from_address', 'missing_required_field', 'invalid_parameter', 'not_found', 'restricted_api_key', 'invalid_api_key', 'missing_api_key', 'test_sender_in_production']);

const emailUsable = (user) => Boolean(user && typeof user.email === 'string' && /@/.test(user.email) && !(user.emailSuppression && user.emailSuppression.at));
const pushDevices = (user) => (user && Array.isArray(user.pushDevices) ? user.pushDevices : []);

/**
 * Adds category, in-app visibility and channel plans to new notification copies before they are
 * inserted. `users` maps userId -> { email, status, communicationPreferences, emailSuppression,
 * pushDevices }. Returns the copies (mutated in place for the caller's insert).
 */
function planChannels(copies, users, now = new Date()) {
  for (const copy of copies) {
    const category = P.categoryOf(copy);
    const user = users.get(String(copy.userId)) || null;
    const prefs = user ? user.communicationPreferences : null;
    const essential = P.CATEGORIES[category].essential;
    const active = P.isActiveAccount(user);
    copy.category = category;
    copy.inApp = essential || P.allows(prefs, category, 'inApp');
    copy.channels = {};
    if (user && (essential || active) && P.allows(prefs, category, 'email')) {
      copy.channels.email = emailUsable(user)
        ? { state: 'queued', attempts: 0, nextAttemptAt: now, updatedAt: now, events: [] }
        : { state: user.emailSuppression ? 'suppressed' : 'skipped', attempts: 0, updatedAt: now, events: [] };
    }
    if (user && active && pushDevices(user).length && P.allows(prefs, category, 'push')) {
      copy.channels.push = { state: 'queued', attempts: 0, nextAttemptAt: now, sent: 0, failed: 0, updatedAt: now };
    }
  }
  return copies;
}

/** Minimal real-time payload: enough to show a badge and refetch; details come from the API. */
function realtimeEvent(doc) {
  return { id: String(doc._id), type: doc.type, category: doc.category || P.categoryOf(doc), createdAt: (doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt || Date.now())).toISOString() };
}

const backoff = (attempts) => BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];

/** Classifies a provider error. Unknown errors are transient (retried, bounded). */
function classify(error) {
  const name = error && typeof error.name === 'string' ? error.name : error && typeof error === 'string' ? error : 'unknown';
  return { name, permanent: PERMANENT_ERRORS.has(name) };
}

/**
 * Processes due emails. `send(to, notification, idempotencyKey)` resolves to
 * { ok: true, providerId } or { ok: false, error: { name } } and must not throw (a throw counts as
 * a transient failure). `render(notification, user)` builds the message. Returns a summary.
 */
async function processEmailQueue(db, { send, now = new Date(), limit = BATCH } = {}) {
  const coll = db.collection('notifications');
  const summary = { claimed: 0, sent: 0, retrying: 0, failed: 0, suppressed: 0 };
  const due = await coll.find({
    $or: [
      { 'channels.email.state': { $in: ['queued', 'retrying'] }, 'channels.email.nextAttemptAt': { $lte: now } },
      // A worker that died mid-send: its lease ran out. The idempotency key makes the resend safe.
      { 'channels.email.state': 'sending', 'channels.email.leaseUntil': { $lte: now } },
    ],
  }, { projection: { _id: 1, userId: 1, type: 1, title: 1, message: 1, category: 1, metadata: 1, channels: 1, createdAt: 1 } }).sort({ 'channels.email.nextAttemptAt': 1 }).limit(limit).toArray();
  if (!due.length) return summary;
  const userIds = [...new Set(due.map((d) => String(d.userId)).filter((id) => /^[a-f0-9]{24}$/i.test(id)))];
  const users = new Map((await db.collection('users').find({ _id: { $in: userIds.map((id) => new ObjectId(id)) } }, { projection: { email: 1, status: 1, name: 1, communicationPreferences: 1, emailSuppression: 1 } }).toArray()).map((u) => [String(u._id), u]));

  for (const doc of due) {
    const e = doc.channels.email;
    // Read before claiming: the claim changes the stored state and attempts.
    const priorState = e.state;
    const priorAttempts = e.attempts || 0;
    const claimed = await coll.updateOne(
      { _id: doc._id, 'channels.email.state': priorState, 'channels.email.attempts': priorAttempts },
      { $set: { 'channels.email.state': 'sending', 'channels.email.leaseUntil': new Date(now.getTime() + LEASE_MS), 'channels.email.updatedAt': now }, $inc: { 'channels.email.attempts': 1 } }
    );
    if (!claimed.matchedCount) continue;
    summary.claimed += 1;
    const attempts = priorAttempts + 1;
    const user = users.get(String(doc.userId));
    const category = doc.category || P.categoryOf(doc);
    // Preferences, suppression and account status are checked again at send time.
    const stop = !user ? 'no_account' : !emailUsable(user) ? (user.emailSuppression ? 'address_suppressed' : 'no_address') : !P.CATEGORIES[category].essential && (!P.isActiveAccount(user) || !P.allows(user.communicationPreferences, category, 'email')) ? 'preference_or_status' : null;
    if (stop) {
      await coll.updateOne({ _id: doc._id }, { $set: { 'channels.email.state': stop === 'no_address' ? 'skipped' : 'suppressed', 'channels.email.lastError': stop, 'channels.email.updatedAt': now }, $unset: { 'channels.email.leaseUntil': '' } });
      summary.suppressed += 1;
      continue;
    }
    let result;
    try {
      result = await send(user.email, { ...doc, category }, `notification:${String(doc._id)}`, user);
    } catch {
      result = { ok: false, error: { name: 'exception' } };
    }
    if (result && result.ok) {
      await coll.updateOne({ _id: doc._id, 'channels.email.state': 'sending' }, { $set: { 'channels.email.state': 'sent', 'channels.email.providerId': result.providerId || null, 'channels.email.sentAt': now, 'channels.email.updatedAt': now }, $unset: { 'channels.email.leaseUntil': '', 'channels.email.lastError': '' } });
      summary.sent += 1;
      continue;
    }
    const { name, permanent } = classify(result && result.error);
    const terminal = permanent || attempts >= MAX_ATTEMPTS;
    await coll.updateOne({ _id: doc._id, 'channels.email.state': 'sending' }, {
      $set: terminal
        ? { 'channels.email.state': 'failed', 'channels.email.lastError': name, 'channels.email.failedAt': now, 'channels.email.updatedAt': now }
        : { 'channels.email.state': 'retrying', 'channels.email.lastError': name, 'channels.email.nextAttemptAt': new Date(now.getTime() + backoff(attempts)), 'channels.email.updatedAt': now },
      $unset: { 'channels.email.leaseUntil': '' },
    });
    if (terminal) {
      summary.failed += 1;
      console.error(JSON.stringify({ event: 'emailDelivery', result: 'failed', notificationId: String(doc._id), reason: name, attempts }));
    } else summary.retrying += 1;
  }
  return summary;
}

/**
 * Applies a verified provider event (lib/communication/resend-webhook.js) to the notification it
 * belongs to, once per event id. Bounces and complaints suppress the address on the user.
 * Returns { applied, duplicate, matched }.
 */
async function applyProviderEvent(db, { eventId, type, providerId, to, bounceType, at = new Date() }) {
  const coll = db.collection('notifications');
  const MAP = { 'email.sent': 'sent', 'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed', 'email.delivery_delayed': null };
  if (!Object.prototype.hasOwnProperty.call(MAP, type)) return { applied: false, duplicate: false, matched: false, ignored: true };
  let matched = false;
  let duplicate = false;
  if (providerId) {
    const doc = await coll.findOne({ 'channels.email.providerId': providerId }, { projection: { _id: 1, channels: 1 } });
    if (doc) {
      matched = true;
      const e = doc.channels.email;
      if ((e.events || []).some((x) => x.id === eventId)) duplicate = true;
      else {
        const next = MAP[type];
        const set = { 'channels.email.events': [...(e.events || []), { id: eventId, type, at }].slice(-EVENT_LOG), 'channels.email.updatedAt': at };
        // Never step backwards (a late "sent" does not undo "delivered" or "bounced").
        if (next && RANK[next] >= RANK[e.state || 'queued']) set['channels.email.state'] = next;
        if (type === 'email.delivered') set['channels.email.deliveredAt'] = at;
        const won = await coll.updateOne({ _id: doc._id, 'channels.email.events.id': { $ne: eventId } }, { $set: set });
        if (!won.modifiedCount) duplicate = true;
      }
    }
  }
  // Hard bounces and complaints suppress the address for every future message (any email kind).
  const suppress = type === 'email.complained' || (type === 'email.bounced' && bounceType !== 'Transient');
  if (suppress && !duplicate && typeof to === 'string' && /@/.test(to)) {
    await db.collection('users').updateOne(
      { email: to.toLowerCase(), 'emailSuppression.at': { $exists: false } },
      { $set: { emailSuppression: { reason: type === 'email.complained' ? 'complaint' : 'bounce', at, eventId } } }
    );
  }
  return { applied: matched && !duplicate, duplicate, matched };
}

/** Operational figures for staff: counts only, no addresses or message contents. */
async function deliveryStats(db, { now = new Date(), windowHours = 24 } = {}) {
  const coll = db.collection('notifications');
  const since = new Date(now.getTime() - windowHours * 3600e3);
  const email = {};
  for (const state of EMAIL_STATES) email[state] = await coll.countDocuments({ 'channels.email.state': state, createdAt: { $gte: since } });
  const queueDepth = await coll.countDocuments({ 'channels.email.state': { $in: ['queued', 'retrying', 'sending'] } });
  const push = {};
  for (const state of ['queued', 'sent', 'partial', 'failed', 'unavailable']) push[state] = await coll.countDocuments({ 'channels.push.state': state, createdAt: { $gte: since } });
  const recentFailures = (await coll.find({ 'channels.email.state': { $in: ['failed', 'bounced', 'complained'] }, 'channels.email.updatedAt': { $gte: since } }, { projection: { type: 1, category: 1, 'channels.email.state': 1, 'channels.email.lastError': 1, 'channels.email.attempts': 1, 'channels.email.updatedAt': 1 } }).sort({ 'channels.email.updatedAt': -1 }).limit(20).toArray())
    .map((d) => ({ id: String(d._id), type: d.type, category: d.category || null, state: d.channels.email.state, reason: d.channels.email.lastError || null, attempts: d.channels.email.attempts || 0, at: d.channels.email.updatedAt }));
  const suppressed = await db.collection('users').countDocuments({ 'emailSuppression.at': { $exists: true } });
  const retrying = await coll.countDocuments({ 'channels.email.state': 'retrying' });
  return { windowHours, email, queueDepth, retrying, push, suppressedAddresses: suppressed, recentFailures };
}

module.exports = { BACKOFF_MS, EMAIL_STATES, MAX_ATTEMPTS, applyProviderEvent, backoff, classify, deliveryStats, planChannels, processEmailQueue, realtimeEvent };
