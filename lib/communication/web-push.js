'use strict';

/**
 * Web Push (Phase 14): browser push through the standard Web Push protocol, with no paid provider
 * and no added dependency. Message encryption follows RFC 8291 (aes128gcm, RFC 8188) and the
 * sender identifies itself with VAPID (RFC 8292), both with Node's crypto.
 *
 * Push is OFF unless VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are configured
 * (scripts/generate-vapid-keys.js makes a pair). Without them, devices can still be listed and
 * removed, push channel plans are marked "unavailable", and in-app and email carry the message.
 *
 * Devices live on the user document (`pushDevices`, at most MAX_DEVICES), so ownership is the
 * document itself: an account can only list, add or remove its own devices. A browser endpoint
 * registered by a second account is removed from the first, so one account never receives pushes
 * meant for another on a shared browser. Endpoints are accepted only from known push services
 * (no arbitrary URLs: the server would otherwise POST to any address it was given).
 */

const crypto = require('crypto');
const { ObjectId } = require('mongodb');

const MAX_DEVICES = 10;
const RECORD_SIZE = 4096;
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/];

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (text) => Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function vapidConfig(env = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY || '';
  const privateKey = env.VAPID_PRIVATE_KEY || '';
  const subject = env.VAPID_SUBJECT || '';
  if (!publicKey || !privateKey || !/^(mailto:|https:\/\/)/.test(subject)) return { ok: false };
  if (unb64u(publicKey).length !== 65 || unb64u(privateKey).length !== 32) return { ok: false };
  return { ok: true, publicKey, privateKey, subject };
}

/** A push endpoint from a known push service over HTTPS, or null. */
function safeEndpoint(value) {
  if (typeof value !== 'string' || value.length > 1024) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  return PUSH_HOSTS.some((re) => re.test(url.hostname)) ? url.toString() : null;
}

/** Validates a browser PushSubscription ({ endpoint, keys: { p256dh, auth } }). */
function readSubscription(input) {
  const s = input && typeof input === 'object' ? input : {};
  const endpoint = safeEndpoint(s.endpoint);
  if (!endpoint) return { ok: false, status: 400, error: 'This browser push service is not supported.' };
  const keys = s.keys && typeof s.keys === 'object' ? s.keys : {};
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return { ok: false, status: 400, error: 'The subscription keys are missing.' };
  const p256dh = unb64u(keys.p256dh);
  const auth = unb64u(keys.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return { ok: false, status: 400, error: 'The subscription keys are not valid.' };
  return { ok: true, subscription: { endpoint, keys: { p256dh: b64u(p256dh), auth: b64u(auth) } } };
}

/**
 * RFC 8291 message encryption. `salt` and `asPrivateKey` are only passed by tests (the RFC test
 * vector); otherwise they are random per message.
 */
function encrypt(payload, { p256dh, auth }, { salt = crypto.randomBytes(16), asPrivateKey = null } = {}) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (asPrivateKey) ecdh.setPrivateKey(unb64u(asPrivateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** RFC 8292 VAPID authorization header for an endpoint. */
function vapidHeader(endpoint, config, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const pub = unb64u(config.publicKey);
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: config.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: config.subject }));
  const signature = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(signature)}, k=${config.publicKey}`;
}

/**
 * Sends one push. Resolves to { ok, status, gone } and never throws: `gone` (404/410) means the
 * browser unsubscribed and the device should be removed.
 */
async function sendPush(device, data, { config = vapidConfig(), fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!config.ok) return { ok: false, status: 0, gone: false, reason: 'not_configured' };
  const endpoint = safeEndpoint(device.endpoint);
  if (!endpoint) return { ok: false, status: 0, gone: true, reason: 'endpoint_rejected' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: vapidHeader(endpoint, config), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
      body: encrypt(JSON.stringify(data), device.keys),
      signal: controller.signal,
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410, reason: `http_${res.status}` };
  } catch {
    return { ok: false, status: 0, gone: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/** Devices and a flat list of their endpoints (queried to move an endpoint between accounts). */
const devicesSet = (list) => ({ pushDevices: list, pushEndpoints: list.map((d) => d.endpoint) });

const presentDevice = (d) => ({ id: d.id, label: d.label || 'Browser', createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null, lastUsedAt: d.lastUsedAt ? new Date(d.lastUsedAt).toISOString() : null, failures: d.failures || 0 });

async function listDevices(db, member) {
  const user = await db.collection('users').findOne({ _id: new ObjectId(member.userId) }, { projection: { pushDevices: 1 } });
  return { ok: true, devices: ((user && user.pushDevices) || []).map(presentDevice), push: { available: vapidConfig().ok, publicKey: vapidConfig().ok ? vapidConfig().publicKey : null } };
}

async function registerDevice(db, member, { subscription, label, sessionFamilyId = null, now = new Date() }) {
  const checked = readSubscription(subscription);
  if (!checked.ok) return checked;
  const users = db.collection('users');
  const name = typeof label === 'string' ? label.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) : '';
  // The endpoint belongs to this browser: no other account keeps it.
  const others = await users.find({ _id: { $ne: new ObjectId(member.userId) }, pushEndpoints: { $in: [checked.subscription.endpoint] } }, { projection: { pushDevices: 1 } }).limit(20).toArray();
  for (const other of others) {
    await users.updateOne({ _id: other._id }, { $set: devicesSet((other.pushDevices || []).filter((d) => d.endpoint !== checked.subscription.endpoint)) });
  }
  const user = await users.findOne({ _id: new ObjectId(member.userId) }, { projection: { pushDevices: 1 } });
  const list = ((user && user.pushDevices) || []).filter((d) => d.endpoint !== checked.subscription.endpoint);
  const existing = ((user && user.pushDevices) || []).find((d) => d.endpoint === checked.subscription.endpoint);
  const device = { id: existing ? existing.id : crypto.randomBytes(12).toString('hex'), endpoint: checked.subscription.endpoint, keys: checked.subscription.keys, label: name || (existing && existing.label) || 'Browser', sessionFamilyId, createdAt: existing ? existing.createdAt : now, lastUsedAt: existing ? existing.lastUsedAt || null : null, failures: 0 };
  const next = [...list, device].slice(-MAX_DEVICES);
  await users.updateOne({ _id: new ObjectId(member.userId) }, { $set: devicesSet(next) });
  return { ok: true, status: existing ? 200 : 201, device: presentDevice(device) };
}

async function revokeDevice(db, member, { deviceId }) {
  if (typeof deviceId !== 'string' || !/^[a-f0-9]{24}$/.test(deviceId)) return { ok: false, status: 404, error: 'Device not found' };
  const users = db.collection('users');
  const user = await users.findOne({ _id: new ObjectId(member.userId) }, { projection: { pushDevices: 1 } });
  const list = (user && user.pushDevices) || [];
  if (!list.some((d) => d.id === deviceId)) return { ok: false, status: 404, error: 'Device not found' };
  await users.updateOne({ _id: new ObjectId(member.userId) }, { $set: devicesSet(list.filter((d) => d.id !== deviceId)) });
  return { ok: true };
}

/** Sign-out: the devices registered in that session stop receiving pushes for the account. */
async function revokeSessionDevices(db, userId, sessionFamilyId, { all = false } = {}) {
  if (!/^[a-f0-9]{24}$/i.test(String(userId))) return;
  const users = db.collection('users');
  const user = await users.findOne({ _id: new ObjectId(String(userId)) }, { projection: { pushDevices: 1 } });
  const list = (user && user.pushDevices) || [];
  const next = all ? [] : list.filter((d) => !sessionFamilyId || d.sessionFamilyId !== sessionFamilyId);
  if (next.length !== list.length) await users.updateOne({ _id: new ObjectId(String(userId)) }, { $set: devicesSet(next) });
}

/**
 * Sends due push plans (notification.channels.push). Each device gets the minimal payload: title,
 * a short line and the in-app destination. Gone devices are removed. Bounded per run.
 */
async function processPushQueue(db, { send = sendPush, config = vapidConfig(), now = new Date(), limit = 25 } = {}) {
  const coll = db.collection('notifications');
  const due = await coll.find({ 'channels.push.state': 'queued', 'channels.push.nextAttemptAt': { $lte: now } }, { projection: { _id: 1, userId: 1, title: 1, metadata: 1, channels: 1 } }).limit(limit).toArray();
  const summary = { claimed: 0, sent: 0, failed: 0, unavailable: 0 };
  for (const doc of due) {
    const claimed = await coll.updateOne({ _id: doc._id, 'channels.push.state': 'queued' }, { $set: { 'channels.push.state': 'sending', 'channels.push.updatedAt': now } });
    if (!claimed.matchedCount) continue;
    summary.claimed += 1;
    if (!config.ok) {
      await coll.updateOne({ _id: doc._id }, { $set: { 'channels.push.state': 'unavailable', 'channels.push.lastError': 'not_configured', 'channels.push.updatedAt': now } });
      summary.unavailable += 1;
      continue;
    }
    const user = /^[a-f0-9]{24}$/i.test(String(doc.userId)) ? await db.collection('users').findOne({ _id: new ObjectId(String(doc.userId)) }, { projection: { pushDevices: 1, status: 1 } }) : null;
    const devices = (user && user.pushDevices) || [];
    const href = doc.metadata && typeof doc.metadata.href === 'string' && doc.metadata.href.startsWith('/') && !doc.metadata.href.startsWith('//') ? doc.metadata.href : '/notifications';
    const data = { id: String(doc._id), title: String(doc.title || 'ForexOrbit Academy').slice(0, 120), url: href };
    let sent = 0;
    let failed = 0;
    const gone = [];
    for (const device of devices) {
      const r = await send(device, data, { config });
      if (r.ok) sent += 1;
      else failed += 1;
      if (r.gone) gone.push(device.endpoint);
    }
    if (gone.length || sent) {
      const keep = devices.filter((d) => !gone.includes(d.endpoint)).map((d) => (sent ? { ...d, lastUsedAt: now } : d));
      await db.collection('users').updateOne({ _id: user._id }, { $set: devicesSet(keep) });
    }
    const state = !devices.length ? 'unavailable' : sent && failed ? 'partial' : sent ? 'sent' : 'failed';
    await coll.updateOne({ _id: doc._id }, { $set: { 'channels.push.state': state, 'channels.push.sent': sent, 'channels.push.failed': failed, 'channels.push.attempts': 1, 'channels.push.updatedAt': now } });
    summary[state === 'partial' ? 'sent' : state] = (summary[state === 'partial' ? 'sent' : state] || 0) + 1;
  }
  return summary;
}

/** A new VAPID key pair (scripts/generate-vapid-keys.js). */
function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

module.exports = { MAX_DEVICES, b64u, encrypt, generateVapidKeys, listDevices, processPushQueue, readSubscription, registerDevice, revokeDevice, revokeSessionDevices, safeEndpoint, sendPush, unb64u, vapidConfig, vapidHeader };
