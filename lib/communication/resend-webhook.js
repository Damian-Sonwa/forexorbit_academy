'use strict';

/**
 * Resend delivery webhooks (Phase 14). Resend signs webhooks the Svix way:
 *   headers  svix-id, svix-timestamp (unix seconds), svix-signature ("v1,<base64> v1,<base64>")
 *   signed   `${svix-id}.${svix-timestamp}.${raw body}` with HMAC-SHA256, key = base64 part of
 *            the endpoint secret "whsec_...".
 * A request is accepted only with a valid signature over the exact raw body and a timestamp within
 * five minutes (replays outside the window are refused; inside it the event id makes processing
 * idempotent, lib/communication/delivery.js applyProviderEvent). Pure: no I/O here.
 */

const crypto = require('crypto');

const TOLERANCE_S = 5 * 60;

function verify(rawBody, headers, secret, { now = Date.now() } = {}) {
  if (typeof secret !== 'string' || !secret.startsWith('whsec_')) return { ok: false, status: 503, error: 'Webhook secret is not configured.' };
  const h = (name) => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : typeof v === 'string' ? v : '';
  };
  const id = h('svix-id');
  const timestamp = h('svix-timestamp');
  const signatures = h('svix-signature');
  if (!id || !/^\d{1,12}$/.test(timestamp) || !signatures) return { ok: false, status: 400, error: 'Missing signature headers.' };
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > TOLERANCE_S) return { ok: false, status: 400, error: 'Timestamp outside the allowed window.' };
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  const match = signatures.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!match) return { ok: false, status: 401, error: 'Invalid signature.' };
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: 'Body is not JSON.' };
  }
  const data = event && typeof event.data === 'object' && event.data ? event.data : {};
  const to = Array.isArray(data.to) ? data.to[0] : typeof data.to === 'string' ? data.to : null;
  return {
    ok: true,
    event: {
      eventId: id,
      type: typeof event.type === 'string' ? event.type : '',
      providerId: typeof data.email_id === 'string' ? data.email_id : null,
      to: typeof to === 'string' ? to.trim().toLowerCase() : null,
      bounceType: data.bounce && typeof data.bounce.type === 'string' ? data.bounce.type : null,
      at: new Date(typeof event.created_at === 'string' ? event.created_at : now),
    },
  };
}

/** Signs a payload as Resend would (tests and local tooling only). */
function sign(rawBody, secret, { id = 'msg_test', timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${sig}` };
}

module.exports = { TOLERANCE_S, sign, verify };
