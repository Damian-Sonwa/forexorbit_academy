/**
 * Phase 14: communication and real-time features.
 *
 * Covers preferences, the single delivery path (dedupe, channel plans, minimal real-time events),
 * the email queue (retries, backoff, terminal failures, suppression, idempotency keys), signed
 * provider webhooks (signature, replay window, duplicates, bounces), the notifications API
 * (scoping, cursors, unread counts), push devices and Web Push (RFC 8291 test vector, endpoint
 * allowlist, ownership, sign-out), community reports and moderation, announcements (audiences,
 * permissions, scheduling, dedupe), communication operations, and the socket contract.
 * Routes run through the real withAuth over the in-memory store; Resend and push services are
 * replaced. Not real-MongoDB or real-provider coverage.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ObjectId } = require('mongodb');
const { paymentMemoryDb } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');
const P = require('../lib/communication/preferences');
const D = require('../lib/communication/delivery');
const W = require('../lib/communication/web-push');
const RW = require('../lib/communication/resend-webhook');
const M = require('../lib/communication/moderation');
const A = require('../lib/communication/announcements');
const { deliverToRecipients } = require('../lib/communication/deliver');
const { renderNotificationEmail, createEmailSender } = require('../lib/communication/email-sender');
const { runTick } = require('../lib/communication/worker');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ROUTE_ENV = { NODE_ENV: 'test', MONGODB_DB_NAME: 'forexorbit_p14_test', MONGO_URI: 'mongodb://127.0.0.1:27017', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined, RESEND_WEBHOOK_SECRET: undefined, VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined };
const newId = () => new ObjectId().toHexString();
const SECRET = `whsec_${Buffer.from('phase-14-test-secret-key-0123456789').toString('base64')}`;

async function withEnv(env, fn) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
const route = (fn, extra = {}) => () => withEnv({ ...ROUTE_ENV, ...extra }, fn);

/** A fake Socket.IO server that records which room got which event. */
function fakeIo() {
  const sent = [];
  return { sent, to: (room) => ({ emit: (event, payload) => sent.push({ room, event, payload }) }) };
}

function world() {
  const db = paymentMemoryDb({ uniqueIndexes: [] });
  const w = { s1: newId(), s2: newId(), s3: newId(), sx: newId(), ins: newId(), ins2: newId(), admin: newId(), CA: newId(), CB: newId() };
  const user = (id, role, extra = {}) => db.rows('users').push({ _id: new ObjectId(id), email: `${role}-${id.slice(-6)}@example.test`, name: `${role} ${id.slice(-4)}`, role, status: 'approved', sessionGeneration: 0, ...extra });
  user(w.s1, 'student');
  user(w.s2, 'student');
  user(w.s3, 'student');
  user(w.sx, 'student', { status: 'suspended' });
  user(w.ins, 'instructor');
  user(w.ins2, 'instructor');
  user(w.admin, 'admin');
  db.rows('courses').push({ _id: new ObjectId(w.CA), title: 'Course A', instructorId: w.ins, status: 'published' });
  db.rows('courses').push({ _id: new ObjectId(w.CB), title: 'Course B', instructorId: w.ins2, status: 'published' });
  db.rows('progress').push({ _id: new ObjectId(), userId: w.s1, courseId: w.CA, progress: 10 });
  db.rows('progress').push({ _id: new ObjectId(), userId: w.s2, courseId: w.CB, progress: 10 });
  const stubs = { 'lib/mongodb': { getDb: async () => db }, 'lib/socket-server': { getSocketServer: () => null } };
  const r = {
    notifications: loadModule('pages/api/notifications/index.ts', stubs).default,
    preferences: loadModule('pages/api/communication/preferences.ts', stubs).default,
    devices: loadModule('pages/api/communication/devices.ts', stubs).default,
    webhook: loadModule('pages/api/webhooks/resend.ts', stubs).default,
    announcements: loadModule('pages/api/announcements/index.ts', stubs).default,
    announcement: loadModule('pages/api/announcements/[id].ts', stubs).default,
    reports: loadModule('pages/api/community/reports.ts', stubs).default,
    moderation: loadModule('pages/api/community/moderation.ts', stubs).default,
    ops: loadModule('pages/api/admin/communication.ts', stubs).default,
    news: loadModule('pages/api/community/news.ts', stubs).default,
    qa: loadModule('lib/community-qa-store.ts', stubs),
  };
  const T = {};
  for (const key of ['s1', 's2', 's3', 'sx', 'ins', 'ins2', 'admin']) T[key] = seedSession(db.rows('sessions'), { userId: w[key], generation: 0, now: new Date() });
  return { db, w, r, T };
}

async function call(handler, { method = 'GET', token, body, query = {} } = {}) {
  const res = mockResponse();
  await handler({ method, url: '/api/test', headers: requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.14' } }, res);
  return res;
}

/** A raw-body request for the webhook route (bodyParser is off there). */
async function postRaw(handler, raw, headers) {
  const res = mockResponse();
  const req = { method: 'POST', headers, async *[Symbol.asyncIterator]() { yield Buffer.from(raw); } };
  await handler(req, res);
  return res;
}

const notes = (x, userId) => x.db.rows('notifications').filter((n) => !userId || n.userId === userId);

// ---------------------------------------------------------------------------
// Preferences and the delivery path
// ---------------------------------------------------------------------------

test('preferences: defaults, essential categories locked on, updates validated', () => {
  const p = P.effectivePreferences(null);
  assert.equal(p.email.learning, true);
  assert.equal(p.email.community, false);
  assert.equal(P.effectivePreferences({ email: { account: false } }).email.account, true);
  assert.equal(P.readPreferencesUpdate({ email: { account: false } }).ok, false);
  assert.equal(P.readPreferencesUpdate({ email: { nope: true } }).ok, false);
  assert.equal(P.readPreferencesUpdate({ email: { learning: 'yes' } }).ok, false);
  assert.deepEqual(P.readPreferencesUpdate({ email: { learning: false } }).update, { email: { learning: false } });
  assert.equal(P.categoryOf({ type: 'system_alert' }), 'account');
  assert.equal(P.categoryOf({ type: 'unknown_type' }), 'learning');
});

test('delivery: one copy per recipient, preferences applied, dedupe on retry, minimal events to own room only', async () => {
  const x = world();
  x.db.rows('users').find((u) => String(u._id) === x.w.s2).communicationPreferences = { inApp: { learning: false }, email: { learning: false } };
  x.db.rows('users').find((u) => String(u._id) === x.w.s3).emailSuppression = { reason: 'bounce', at: new Date() };
  const io = fakeIo();
  const params = { type: 'task_feedback', title: 'Graded', message: 'Your grade: 85 / 100 with private notes', roleTarget: 'student', dedupeKey: 'grade:1', metadata: { href: '/tasks/1' } };
  await deliverToRecipients(x.db, params, [x.w.s1, x.w.s2, x.w.s3, x.w.sx], { io });
  const byUser = (id) => notes(x, id)[0];
  assert.equal(byUser(x.w.s1).channels.email.state, 'queued');
  assert.equal(byUser(x.w.s1).category, 'learning');
  assert.equal(byUser(x.w.s2).inApp, false);
  assert.equal(byUser(x.w.s2).channels.email, undefined);
  assert.equal(byUser(x.w.s3).channels.email.state, 'suppressed');
  assert.equal(byUser(x.w.sx).channels.email, undefined); // inactive account: optional email not planned
  // Real-time: only to each recipient's own room, with no message text; none for in-app-off copies.
  assert.deepEqual(io.sent.map((e) => e.room).sort(), [`user:${x.w.s1}`, `user:${x.w.s3}`, `user:${x.w.sx}`].sort());
  assert.ok(io.sent.every((e) => e.event === 'notification:new' && e.payload.message === undefined && /^[a-f0-9]{24}$/.test(e.payload.id)));
  assert.equal(JSON.stringify(io.sent).includes('private notes'), false);
  // A retried delivery with the same key creates nothing and emits nothing.
  await deliverToRecipients(x.db, params, [x.w.s1, x.w.s2, x.w.s3, x.w.sx], { io });
  assert.equal(notes(x).length, 4);
  assert.equal(io.sent.length, 3);
  // Essential messages ignore preferences.
  x.db.rows('users').find((u) => String(u._id) === x.w.s2).communicationPreferences = { inApp: { account: false }, email: { account: false } };
  await deliverToRecipients(x.db, { type: 'system_alert', title: 'Security', message: 'x', roleTarget: 'student' }, [x.w.s2], { io });
  const essential = notes(x, x.w.s2).find((n) => n.type === 'system_alert');
  assert.equal(essential.inApp, true);
  assert.equal(essential.channels.email.state, 'queued');
});

// ---------------------------------------------------------------------------
// Email queue
// ---------------------------------------------------------------------------

test('email queue: sends once with an idempotency key, retries transient failures with backoff, stops at a terminal state', async () => {
  const x = world();
  await deliverToRecipients(x.db, { type: 'task_feedback', title: 'A', message: 'm', roleTarget: 'student' }, [x.w.s1], { io: null });
  const calls = [];
  const ok = async (to, n, key) => { calls.push({ to, key }); return { ok: true, providerId: 'em_1' }; };
  const t0 = new Date();
  assert.equal((await D.processEmailQueue(x.db, { send: ok, now: t0 })).sent, 1);
  const doc = notes(x, x.w.s1)[0];
  assert.equal(doc.channels.email.state, 'sent');
  assert.equal(doc.channels.email.providerId, 'em_1');
  assert.equal(calls[0].key, `notification:${String(doc._id)}`);
  assert.equal(calls[0].to, x.db.rows('users').find((u) => String(u._id) === x.w.s1).email);
  // A second run sends nothing.
  await D.processEmailQueue(x.db, { send: ok, now: new Date(t0.getTime() + 1000) });
  assert.equal(calls.length, 1);

  // Transient failures: retried with growing delays, failed after the maximum.
  await deliverToRecipients(x.db, { type: 'task_feedback', title: 'B', message: 'm', roleTarget: 'student' }, [x.w.s3 === x.w.s3 ? x.w.ins : x.w.ins], { io: null });
  const failing = async () => ({ ok: false, error: { name: 'rate_limit_exceeded' } });
  let now = new Date();
  const target = () => notes(x, x.w.ins)[0];
  for (let i = 1; i <= D.MAX_ATTEMPTS; i += 1) {
    await D.processEmailQueue(x.db, { send: failing, now });
    const e = target().channels.email;
    assert.equal(e.attempts, i);
    if (i < D.MAX_ATTEMPTS) {
      assert.equal(e.state, 'retrying');
      assert.equal(new Date(e.nextAttemptAt).getTime() - now.getTime(), D.BACKOFF_MS[i - 1]);
      // Not due yet: nothing happens.
      await D.processEmailQueue(x.db, { send: failing, now: new Date(now.getTime() + 1000) });
      assert.equal(target().channels.email.attempts, i);
      now = new Date(new Date(e.nextAttemptAt).getTime() + 1);
    } else {
      assert.equal(e.state, 'failed');
      assert.equal(e.lastError, 'rate_limit_exceeded');
    }
  }
  // Permanent errors fail at once; exceptions count as transient.
  await deliverToRecipients(x.db, { type: 'task_feedback', title: 'C', message: 'm', roleTarget: 'student' }, [x.w.ins2], { io: null });
  await D.processEmailQueue(x.db, { send: async () => ({ ok: false, error: { name: 'validation_error' } }), now: new Date() });
  assert.equal(notes(x, x.w.ins2)[0].channels.email.state, 'failed');
  assert.equal(notes(x, x.w.ins2)[0].channels.email.attempts, 1);
  await deliverToRecipients(x.db, { type: 'task_feedback', title: 'E', message: 'm', roleTarget: 'student' }, [x.w.admin], { io: null });
  await D.processEmailQueue(x.db, { send: async () => { throw new Error('boom'); }, now: new Date() });
  assert.equal(notes(x, x.w.admin)[0].channels.email.state, 'retrying');
});

test('email queue: preferences, suppression and a stale lease are re-checked at send time', async () => {
  const x = world();
  await deliverToRecipients(x.db, { type: 'task_feedback', title: 'A', message: 'm', roleTarget: 'student' }, [x.w.s1, x.w.s2], { io: null });
  // s1 turns learning emails off after the email was queued; s2's address bounces.
  x.db.rows('users').find((u) => String(u._id) === x.w.s1).communicationPreferences = { email: { learning: false } };
  x.db.rows('users').find((u) => String(u._id) === x.w.s2).emailSuppression = { reason: 'bounce', at: new Date() };
  const calls = [];
  await D.processEmailQueue(x.db, { send: async (to) => { calls.push(to); return { ok: true, providerId: 'x' }; }, now: new Date() });
  assert.equal(calls.length, 0);
  assert.deepEqual(notes(x).map((n) => n.channels.email.state), ['suppressed', 'suppressed']);
  // A worker that died mid-send: the lease runs out and the same idempotency key is reused.
  const y = world();
  await deliverToRecipients(y.db, { type: 'task_feedback', title: 'A', message: 'm', roleTarget: 'student' }, [y.w.s1], { io: null });
  const n = notes(y)[0];
  n.channels.email.state = 'sending';
  n.channels.email.attempts = 1;
  n.channels.email.leaseUntil = new Date(Date.now() - 1000);
  const keys = [];
  await D.processEmailQueue(y.db, { send: async (to, doc, key) => { keys.push(key); return { ok: true, providerId: 'p' }; }, now: new Date() });
  assert.deepEqual(keys, [`notification:${String(n._id)}`]);
  assert.equal(notes(y)[0].channels.email.state, 'sent');
});

test('email template and sender: escaped, branded, essential wording, provider id or error name', async () => {
  const html = renderNotificationEmail({ name: '<b>Sam</b>', title: 'Grade <script>', message: 'Hi & bye', category: 'learning', href: '//evil.example', appBaseUrl: 'https://forexorbit.example' });
  assert.equal(html.html.includes('<script>'), false);
  assert.match(html.html, /&lt;script&gt;/);
  assert.match(html.html, /https:\/\/forexorbit\.example\/notifications/); // unsafe href replaced
  assert.match(html.html, /settings\/communication/);
  assert.match(renderNotificationEmail({ title: 'x', message: 'y', category: 'account', appBaseUrl: 'https://a.example' }).text, /essential account message/);
  const env = { RESEND_API_KEY: 're_test', RESEND_FROM: 'ForexOrbit <noreply@example.com>', APP_BASE_URL: 'https://a.example', NODE_ENV: 'test' };
  const seen = [];
  const send = createEmailSender({ env, client: { emails: { send: async (msg, opts) => { seen.push(opts.idempotencyKey); return { data: { id: 'em_9' } }; } } } });
  assert.deepEqual(await send('a@b.c', { title: 't', message: 'm', category: 'learning' }, 'notification:1'), { ok: true, providerId: 'em_9' });
  assert.deepEqual(seen, ['notification:1']);
  const bad = createEmailSender({ env, client: { emails: { send: async () => ({ error: { name: 'validation_error' } }) } } });
  assert.deepEqual(await bad('a@b.c', { title: 't', message: 'm', category: 'learning' }, 'k'), { ok: false, error: { name: 'validation_error' } });
  assert.deepEqual(await createEmailSender({ env: { NODE_ENV: 'production', RESEND_API_KEY: 'k', RESEND_FROM: 'x@resend.dev', APP_BASE_URL: 'https://a.example' } })('a@b.c', {}, 'k'), { ok: false, error: { name: 'test_sender_in_production' } });
});

// ---------------------------------------------------------------------------
// Provider webhooks
// ---------------------------------------------------------------------------

test('webhook: signature, replay window, idempotent events, no downgrade, bounce suppression', route(async () => {
  const x = world();
  await deliverToRecipients(x.db, { type: 'task_feedback', title: 'A', message: 'm', roleTarget: 'student' }, [x.w.s1], { io: null });
  await D.processEmailQueue(x.db, { send: async () => ({ ok: true, providerId: 'em_abc' }), now: new Date() });
  const email = x.db.rows('users').find((u) => String(u._id) === x.w.s1).email;
  const event = (type, extra = {}) => JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: 'em_abc', to: [email], ...extra } });
  const delivered = event('email.delivered');
  // No secret configured: refused, not processed.
  assert.equal((await postRaw(x.r.webhook, delivered, RW.sign(delivered, SECRET, { id: 'evt_1' }))).statusCode, 503);
  await withEnv({ RESEND_WEBHOOK_SECRET: SECRET }, async () => {
    assert.equal((await postRaw(x.r.webhook, delivered, { ...RW.sign(delivered, SECRET, { id: 'evt_1' }), 'svix-signature': 'v1,AAAA' })).statusCode, 401);
    assert.equal((await postRaw(x.r.webhook, delivered, RW.sign(delivered, SECRET, { id: 'evt_1', timestamp: Math.floor(Date.now() / 1000) - 3600 }))).statusCode, 400);
    // A body changed after signing fails.
    assert.equal((await postRaw(x.r.webhook, delivered.replace('delivered', 'bounced'), RW.sign(delivered, SECRET, { id: 'evt_1' }))).statusCode, 401);
    assert.equal((await postRaw(x.r.webhook, delivered, RW.sign(delivered, SECRET, { id: 'evt_1' }))).statusCode, 200);
    assert.equal(notes(x, x.w.s1)[0].channels.email.state, 'delivered');
    // The same event again changes nothing; a late "sent" does not step back.
    assert.equal((await postRaw(x.r.webhook, delivered, RW.sign(delivered, SECRET, { id: 'evt_1' }))).statusCode, 200);
    assert.equal(notes(x, x.w.s1)[0].channels.email.events.length, 1);
    const sent = event('email.sent');
    await postRaw(x.r.webhook, sent, RW.sign(sent, SECRET, { id: 'evt_2' }));
    assert.equal(notes(x, x.w.s1)[0].channels.email.state, 'delivered');
    // A hard bounce suppresses the address; a transient one does not.
    const soft = event('email.bounced', { bounce: { type: 'Transient' } });
    await postRaw(x.r.webhook, soft, RW.sign(soft, SECRET, { id: 'evt_3' }));
    assert.equal(x.db.rows('users').find((u) => String(u._id) === x.w.s1).emailSuppression, undefined);
    const hard = event('email.bounced', { bounce: { type: 'Permanent' } });
    await postRaw(x.r.webhook, hard, RW.sign(hard, SECRET, { id: 'evt_4' }));
    assert.equal(x.db.rows('users').find((u) => String(u._id) === x.w.s1).emailSuppression.reason, 'bounce');
  });
  // Later emails to that address are suppressed, not sent.
  await deliverToRecipients(x.db, { type: 'task_feedback', title: 'B', message: 'm', roleTarget: 'student' }, [x.w.s1], { io: null });
  assert.equal(notes(x, x.w.s1)[1].channels.email.state, 'suppressed');
}));

// ---------------------------------------------------------------------------
// In-app notifications API
// ---------------------------------------------------------------------------

test('notifications API: own only, bounded pages, cursors, true unread count, hidden in-app-off copies', route(async () => {
  const x = world();
  const base = Date.now() - 100000;
  for (let i = 0; i < 30; i += 1) x.db.rows('notifications').push({ _id: new ObjectId(), userId: x.w.s1, type: 'task_feedback', title: `n${i}`, message: 'm', read: i < 5, createdAt: new Date(base + i * 1000) });
  x.db.rows('notifications').push({ _id: new ObjectId(), userId: x.w.s1, type: 'task_feedback', title: 'hidden', message: 'm', read: false, inApp: false, createdAt: new Date(base + 50000) });
  x.db.rows('notifications').push({ _id: new ObjectId(), userId: x.w.s2, type: 'task_feedback', title: 'other', message: 'secret', read: false, createdAt: new Date(base + 60000) });
  const first = await call(x.r.notifications, { token: x.T.s1, query: { limit: '500' } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.notifications.length, 30 > 50 ? 50 : 30);
  const page = await call(x.r.notifications, { token: x.T.s1, query: { limit: '10' } });
  assert.equal(page.body.notifications.length, 10);
  assert.equal(page.body.unreadCount, 25);
  assert.equal(page.body.hasMore, true);
  assert.equal(page.body.notifications[0].title, 'n29');
  assert.ok(page.body.notifications.every((n) => n.userId === x.w.s1 && n.title !== 'hidden'));
  const next = await call(x.r.notifications, { token: x.T.s1, query: { limit: '10', before: page.body.nextCursor } });
  assert.equal(next.body.notifications[0].title, 'n19');
  // Reconnect catch-up: only what arrived after the last one seen, oldest first.
  const after = await call(x.r.notifications, { token: x.T.s1, query: { after: new Date(base + 26500).toISOString() } });
  assert.deepEqual(after.body.notifications.map((n) => n.title), ['n29', 'n28', 'n27']);
  // Another user's id in the body cannot be marked read.
  const theirs = x.db.rows('notifications').find((n) => n.userId === x.w.s2);
  await call(x.r.notifications, { method: 'PUT', token: x.T.s1, body: { notificationId: String(theirs._id) } });
  assert.equal(theirs.read, false);
  assert.equal(JSON.stringify((await call(x.r.notifications, { token: x.T.s1 })).body).includes('secret'), false);
  // Suspended accounts cannot read notifications.
  assert.ok([401, 403].includes((await call(x.r.notifications, { token: x.T.sx })).statusCode));
}));

test('preferences API: own document only, essential refused, effective values returned', route(async () => {
  const x = world();
  const get = await call(x.r.preferences, { token: x.T.s1 });
  assert.equal(get.statusCode, 200);
  assert.equal(get.body.categories.find((c) => c.id === 'account').essential, true);
  assert.equal((await call(x.r.preferences, { method: 'PUT', token: x.T.s1, body: { email: { account: false } } })).statusCode, 400);
  const put = await call(x.r.preferences, { method: 'PUT', token: x.T.s1, body: { email: { community: true, learning: false }, push: { messages: false } } });
  assert.equal(put.statusCode, 200);
  assert.equal(put.body.preferences.email.community, true);
  assert.equal(put.body.preferences.email.learning, false);
  const stored = x.db.rows('users').find((u) => String(u._id) === x.w.s1).communicationPreferences;
  assert.equal(stored.email.learning, false);
  assert.equal(x.db.rows('users').find((u) => String(u._id) === x.w.s2).communicationPreferences, undefined);
}));

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

const sub = (n = 1) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } });

test('web push: RFC 8291 test vector, VAPID signature, endpoint allowlist', () => {
  const out = W.encrypt('When I grow up, I want to be a watermelon', sub().keys, { salt: W.unb64u('DGv6ra1nlYgDCS1FRnbzlw'), asPrivateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' });
  assert.equal(W.b64u(out), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  const keys = W.generateVapidKeys();
  const header = W.vapidHeader('https://fcm.googleapis.com/fcm/send/x', { ...keys, subject: 'mailto:ops@example.com' });
  const jwt = /t=([^,]+)/.exec(header)[1];
  const [h, c, s] = jwt.split('.');
  const pub = W.unb64u(keys.publicKey);
  const key = require('crypto').createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: W.b64u(pub.subarray(1, 33)), y: W.b64u(pub.subarray(33)) } });
  assert.equal(require('crypto').verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, W.unb64u(s)), true);
  assert.equal(JSON.parse(W.unb64u(c).toString()).aud, 'https://fcm.googleapis.com');
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/push', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x', 'javascript:alert(1)']) assert.equal(W.safeEndpoint(bad), null, bad);
  assert.ok(W.safeEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'));
  assert.equal(W.readSubscription({ ...sub(), keys: { p256dh: 'short', auth: 'x' } }).ok, false);
  assert.equal(W.vapidConfig({}).ok, false);
});

test('devices: registration needs push configured; own devices only; an endpoint moves with its browser; sign-out revokes', route(async () => {
  const x = world();
  assert.equal((await call(x.r.devices, { method: 'POST', token: x.T.s1, body: { subscription: sub(1) } })).statusCode, 503);
  const keys = W.generateVapidKeys();
  await withEnv({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:ops@example.com' }, async () => {
    const reg = await call(x.r.devices, { method: 'POST', token: x.T.s1, body: { subscription: sub(1), label: 'Laptop <b>' } });
    assert.equal(reg.statusCode, 201);
    assert.equal(reg.body.device.label, 'Laptop b');
    assert.equal(JSON.stringify(reg.body).includes('fcm.googleapis.com'), false); // endpoints are never returned
    assert.equal((await call(x.r.devices, { method: 'POST', token: x.T.s1, body: { subscription: { ...sub(2), endpoint: 'https://evil.example/x' } } })).statusCode, 400);
    const list = await call(x.r.devices, { token: x.T.s1 });
    assert.equal(list.body.devices.length, 1);
    assert.equal(list.body.push.available, true);
    // Another account cannot remove it.
    assert.equal((await call(x.r.devices, { method: 'DELETE', token: x.T.s2, query: { id: reg.body.device.id } })).statusCode, 404);
    // The same browser signed in as s2: the endpoint leaves s1.
    await call(x.r.devices, { method: 'POST', token: x.T.s2, body: { subscription: sub(1) } });
    const s1 = x.db.rows('users').find((u) => String(u._id) === x.w.s1);
    assert.equal(s1.pushDevices.length, 0);
    assert.equal(x.db.rows('users').find((u) => String(u._id) === x.w.s2).pushDevices.length, 1);
  });
  // Sign-out of that session removes its devices; sign-out everywhere removes all.
  const s2 = x.db.rows('users').find((u) => String(u._id) === x.w.s2);
  const family = s2.pushDevices[0].sessionFamilyId;
  await W.revokeSessionDevices(x.db, x.w.s2, 'another-family');
  assert.equal(s2.pushDevices.length, 1);
  await W.revokeSessionDevices(x.db, x.w.s2, family);
  assert.equal(x.db.rows('users').find((u) => String(u._id) === x.w.s2).pushDevices.length, 0);
  assert.match(read('lib/session-auth.ts'), /revokeSessionDevices\(db, String\(session\.userId/);
  assert.match(read('lib/session-auth.ts'), /revokeSessionDevices\(db, userId, null, \{ all: true \}\)/);
}));

test('push queue: unavailable without keys; sends to own devices, removes gone ones, minimal payload', async () => {
  const x = world();
  const u = x.db.rows('users').find((d) => String(d._id) === x.w.s1);
  u.pushDevices = [{ id: 'a'.repeat(24), ...sub(1) }, { id: 'b'.repeat(24), ...sub(2) }];
  await deliverToRecipients(x.db, { type: 'task_feedback', title: 'Graded', message: 'private feedback text', roleTarget: 'student', metadata: { href: '/x' } }, [x.w.s1], { io: null });
  assert.equal(notes(x, x.w.s1)[0].channels.push.state, 'queued');
  await W.processPushQueue(x.db, { config: { ok: false } });
  assert.equal(notes(x, x.w.s1)[0].channels.push.state, 'unavailable');
  notes(x, x.w.s1)[0].channels.push.state = 'queued';
  const payloads = [];
  const send = async (device, data) => { payloads.push({ endpoint: device.endpoint, data }); return device.endpoint.endsWith('2') ? { ok: false, gone: true, status: 410 } : { ok: true, status: 201, gone: false }; };
  await W.processPushQueue(x.db, { send, config: { ok: true } });
  assert.equal(notes(x, x.w.s1)[0].channels.push.state, 'partial');
  assert.equal(x.db.rows('users').find((d) => String(d._id) === x.w.s1).pushDevices.length, 1);
  assert.ok(payloads.every((p) => p.data.url === '/x' && !JSON.stringify(p.data).includes('private feedback')));
});

// ---------------------------------------------------------------------------
// Community moderation
// ---------------------------------------------------------------------------

test('community: reports are one per member and never on your own post; moderators only; hidden content is kept but not shown', route(async () => {
  const x = world();
  const q = new ObjectId();
  x.db.rows('communityQuestions').push({ _id: q, title: 'Buy my signals', body: 'spam', authorId: x.w.s2, category: 'strategy', score: 0, replyCount: 0, acceptedReplyId: null, createdAt: new Date(), lastActivityAt: new Date() });
  const reportIt = (token, body = {}) => call(x.r.reports, { method: 'POST', token, body: { targetType: 'question', targetId: String(q), reason: 'spam', ...body } });
  assert.equal((await reportIt(x.T.s2)).statusCode, 400);
  assert.equal((await reportIt(x.T.s1)).statusCode, 201);
  assert.equal((await reportIt(x.T.s1)).statusCode, 200);
  assert.equal(x.db.rows('communityQuestions')[0].reportCount, 1);
  assert.equal((await reportIt(x.T.s3, { reason: 'other' })).statusCode, 400);
  assert.equal((await reportIt(x.T.s3, { reason: 'nope' })).statusCode, 400);
  // Students cannot see the queue or moderate.
  assert.ok([401, 403].includes((await call(x.r.moderation, { token: x.T.s1 })).statusCode));
  assert.ok([401, 403].includes((await call(x.r.moderation, { method: 'POST', token: x.T.s1, body: { targetType: 'question', targetId: String(q), action: 'hide', reason: 'spam post' } })).statusCode));
  const queue = await call(x.r.moderation, { token: x.T.ins });
  assert.equal(queue.body.items.length, 1);
  assert.equal(queue.body.items[0].reasons[0].count, 1);
  assert.equal(JSON.stringify(queue.body).includes(x.w.s1), false); // reporters are not identified
  assert.equal((await call(x.r.moderation, { method: 'POST', token: x.T.ins, body: { targetType: 'question', targetId: String(q), action: 'hide', reason: 'x' } })).statusCode, 400);
  assert.equal((await call(x.r.moderation, { method: 'POST', token: x.T.ins, body: { targetType: 'question', targetId: String(q), action: 'hide', reason: 'Advertising paid signals' } })).statusCode, 200);
  assert.equal(x.db.rows('communityQuestions').length, 1); // kept as evidence
  assert.equal(x.db.rows('adminAuditLog').filter((a) => a.action === 'community_hide').length, 1);
  // Hidden from other members' list and detail; the author and moderators still see it.
  const list = await x.r.qa.listQuestions({ userId: x.w.s1, role: 'student' }, {});
  assert.equal(list.questions.length, 0);
  await assert.rejects(() => x.r.qa.getQuestion({ userId: x.w.s1, role: 'student' }, String(q), 1), (e) => e.status === 404);
  assert.ok(await x.r.qa.getQuestion({ userId: x.w.s2, role: 'student' }, String(q), 1));
  assert.ok(await x.r.qa.getQuestion({ userId: x.w.ins, role: 'instructor' }, String(q), 1));
  assert.equal((await call(x.r.moderation, { method: 'POST', token: x.T.admin, body: { targetType: 'question', targetId: String(q), action: 'restore', reason: 'Reviewed again, acceptable' } })).statusCode, 200);
  assert.equal((await x.r.qa.listQuestions({ userId: x.w.s1, role: 'student' }, {})).questions.length, 1);
}));

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

test('announcements: audiences and permissions, notify once, scheduling, expiry, kept out of community news', route(async () => {
  const x = world();
  const create = (token, body) => call(x.r.announcements, { method: 'POST', token, body: { title: 'Exam week', body: 'Practical tasks are due Friday.', ...body } });
  assert.ok([401, 403].includes((await create(x.T.s1, { audience: 'all' })).statusCode));
  assert.equal((await create(x.T.ins, { audience: 'all' })).statusCode, 403);
  assert.equal((await create(x.T.ins, { audience: 'course', courseId: x.w.CB })).statusCode, 403);
  const own = await create(x.T.ins, { audience: 'course', courseId: x.w.CA });
  assert.equal(own.statusCode, 201);
  const id = own.body.announcement.id;
  // Drafts are not visible; another instructor cannot publish it.
  assert.equal((await call(x.r.announcements, { token: x.T.s1 })).body.announcements.length, 0);
  assert.equal((await call(x.r.announcement, { method: 'POST', token: x.T.ins2, query: { id }, body: { action: 'publish' } })).statusCode, 404);
  const pub = await call(x.r.announcement, { method: 'POST', token: x.T.ins, query: { id }, body: { action: 'publish' } });
  assert.equal(pub.statusCode, 200);
  const recipients = notes(x).filter((n) => n.dedupeKey === `announcement:${id}`).map((n) => n.userId).sort();
  assert.deepEqual(recipients, [x.w.s1, x.w.ins].sort()); // course A's enrollee and its instructor
  await call(x.r.announcement, { method: 'POST', token: x.T.ins, query: { id }, body: { action: 'publish' } });
  assert.equal(notes(x).filter((n) => n.dedupeKey === `announcement:${id}`).length, 2);
  assert.equal((await call(x.r.announcements, { token: x.T.s1 })).body.announcements.length, 1);
  assert.equal((await call(x.r.announcements, { token: x.T.s2 })).body.announcements.length, 0);
  // The audience of a published announcement cannot change.
  assert.equal((await call(x.r.announcement, { method: 'PUT', token: x.T.ins, query: { id }, body: { title: 'x', body: 'y', audience: 'course', courseId: x.w.CB } })).statusCode, 403);
  // Admin, platform-wide, scheduled: published by the worker when due, once.
  const later = new Date(Date.now() + 3600e3);
  const sched = await create(x.T.admin, { audience: 'students', publishAt: later.toISOString(), expiresAt: new Date(later.getTime() + 3600e3).toISOString() });
  const sid = sched.body.announcement.id;
  assert.equal((await call(x.r.announcement, { method: 'POST', token: x.T.admin, query: { id: sid }, body: { action: 'publish' } })).body.announcement.status, 'scheduled');
  await runTick(x.db, { send: async () => ({ ok: true, providerId: 'p' }), sendPush: async () => ({ ok: true }), now: new Date() });
  assert.equal(notes(x).filter((n) => n.dedupeKey === `announcement:${sid}`).length, 0);
  await runTick(x.db, { send: async () => ({ ok: true, providerId: 'p' }), now: new Date(later.getTime() + 1000) });
  await runTick(x.db, { send: async () => ({ ok: true, providerId: 'p' }), now: new Date(later.getTime() + 2000) });
  const studentCopies = notes(x).filter((n) => n.dedupeKey === `announcement:${sid}`);
  assert.deepEqual(studentCopies.map((n) => n.userId).sort(), [x.w.s1, x.w.s2, x.w.s3].sort()); // active students only (not suspended)
  // Expired announcements are no longer listed.
  const doc = x.db.rows('communityNews').find((n) => String(n._id) === sid);
  doc.expiresAt = new Date(Date.now() - 1000);
  assert.equal((await call(x.r.announcements, { token: x.T.s2 })).body.announcements.length, 0);
  // Community news never shows announcements.
  x.db.rows('communityNews').push({ _id: new ObjectId(), title: 'News', description: 'd', category: 'market', createdAt: new Date() });
  const news = await call(x.r.news, { token: x.T.s1 });
  const items = Array.isArray(news.body) ? news.body : news.body.news || news.body.items || [];
  assert.ok(items.length >= 1 && items.every((n) => n.title === 'News'));
  assert.ok(x.db.rows('adminAuditLog').some((a) => a.action === 'announcement_published'));
}));

// ---------------------------------------------------------------------------
// Operations and real time
// ---------------------------------------------------------------------------

test('operations: staff only, counts without addresses or contents, provider flags without secrets', route(async () => {
  const x = world();
  await deliverToRecipients(x.db, { type: 'task_feedback', title: 'A', message: 'very private message', roleTarget: 'student' }, [x.w.s1, x.w.s2], { io: null });
  await D.processEmailQueue(x.db, { send: async (to) => (to.includes(x.w.s1.slice(-6)) ? { ok: true, providerId: 'p' } : { ok: false, error: { name: 'validation_error' } }), now: new Date() });
  assert.ok([401, 403].includes((await call(x.r.ops, { token: x.T.s1 })).statusCode));
  assert.ok([401, 403].includes((await call(x.r.ops, { token: x.T.ins })).statusCode));
  const ops = await call(x.r.ops, { token: x.T.admin });
  assert.equal(ops.statusCode, 200);
  assert.equal(ops.body.email.sent, 1);
  assert.equal(ops.body.email.failed, 1);
  assert.equal(ops.body.recentFailures[0].reason, 'validation_error');
  const text = JSON.stringify(ops.body);
  assert.equal(text.includes('@example.test'), false);
  assert.equal(text.includes('very private'), false);
  assert.equal(typeof ops.body.providers.email, 'boolean');
  assert.ok(ops.body.realtime && typeof ops.body.realtime.counters === 'object');
}));

test('socket contract: authenticated by session, rooms decided on the server, recovery from the API', () => {
  const server = read('server.js');
  assert.match(server, /readSessionCookie\(socket\.handshake\.headers\.cookie\)/);
  assert.match(server, /communicationMetrics\.count\('socketRefused'\)/);
  assert.match(server, /socket\.join\(`user:\$\{user\.userId\}`\)/); // the user room comes from the session, never the client
  assert.match(server, /COMMUNICATION_WORKER_SECONDS/);
  const header = read('components/Header.tsx');
  assert.match(header, /socket\.on\('notification:new', refresh\)/);
  assert.match(header, /socket\.on\('connect', refresh\)/);
  assert.equal(/setUnreadCount\(\(prev\) => prev \+ 1\)/.test(header), false); // counts come from the API only
  const deliver = read('lib/communication/deliver.js');
  assert.match(deliver, /io\.to\(`user:\$\{copy\.userId\}`\)\.emit\('notification:new'/);
  assert.equal(/io\.emit\(/.test(deliver), false); // never a broadcast
});
