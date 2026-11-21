'use strict';

/**
 * Notification emails (Phase 14): the branded template and the Resend send used by the delivery
 * queue (lib/communication/delivery.js). Plain JS so the background worker in server.js can load
 * it. The settings rules match lib/email.ts (account emails): RESEND_API_KEY, RESEND_FROM (the
 * Resend test sender is refused in production) and APP_BASE_URL.
 *
 * "Sent" here means Resend accepted the message and returned an id. Delivery, bounces and
 * complaints arrive later through the signed webhook (pages/api/webhooks/resend.ts).
 */

const { CATEGORIES } = require('./preferences');

const BRAND = 'ForexOrbit Academy';
const ACCENT = '#B85C0E'; // the accessible orange used by the account emails (brand #FF7012 on white fails contrast for text)
const TIMEOUT_MS = 10_000;
const COPY = {
  account: { prefix: 'Account', action: 'Open ForexOrbit' },
  learning: { prefix: 'Learning', action: 'View in ForexOrbit' },
  consultations: { prefix: 'Consultation', action: 'View consultation' },
  announcements: { prefix: 'Announcement', action: 'Read the announcement' },
  community: { prefix: 'Community', action: 'Open the discussion' },
  messages: { prefix: 'Message', action: 'Open the conversation' },
};

const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const apiKey = (env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, reason: 'missing_api_key' };
  const from = (env.RESEND_FROM || '').trim() || (production ? '' : 'onboarding@resend.dev');
  if (!from) return { ok: false, reason: 'missing_sender' };
  if (production && /@resend\.dev\s*>?\s*$/i.test(from)) return { ok: false, reason: 'test_sender_in_production' };
  const raw = (env.APP_BASE_URL || '').trim() || (production ? '' : 'http://localhost:3000');
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_app_base_url' };
  }
  if (url.protocol !== 'https:' && (production || url.protocol !== 'http:')) return { ok: false, reason: 'invalid_app_base_url' };
  return { ok: true, apiKey, from, appBaseUrl: url.origin };
}

const safePath = (href) => (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && !href.includes('\\') ? href : '/notifications');

/** Renders a notification email. Text is escaped; protected details stay behind the app link. */
function renderNotificationEmail({ name, title, message, category, href, appBaseUrl }) {
  const copy = COPY[category] || COPY.learning;
  const essential = Boolean(CATEGORIES[category] && CATEGORIES[category].essential);
  const heading = String(title || BRAND).slice(0, 140);
  const body = String(message || '').slice(0, 600);
  const who = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'there';
  const actionUrl = `${appBaseUrl}${safePath(href)}`;
  const prefsUrl = `${appBaseUrl}/settings/communication`;
  const p = (html) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#44403c;">${html}</p>`;
  const footer = essential
    ? p('This is an essential account message, so it is sent whatever your notification settings are.')
    : p(`You receive these because ${escapeHtml(copy.prefix.toLowerCase())} emails are on. <a href="${escapeHtml(prefsUrl)}" style="color:${ACCENT};">Change your email preferences</a>.`);
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(body.slice(0, 120))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;">
<tr><td style="padding:24px 32px;border-bottom:3px solid #FF7012;font-size:18px;font-weight:bold;color:#1c1917;">${BRAND}</td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:${ACCENT};">${escapeHtml(copy.prefix)}</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1c1917;">${escapeHtml(heading)}</h1>
${p(`Hello ${escapeHtml(who)},`)}${p(escapeHtml(body))}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background:${ACCENT};"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(copy.action)}</a></td></tr></table>
${footer}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e7e5e4;font-size:12px;line-height:1.5;color:#78716c;">This is an automated message from ${BRAND}. Please do not reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hello ${who},\n\n${body}\n\n${copy.action}: ${actionUrl}\n\n${essential ? 'This is an essential account message.' : `Change your email preferences: ${prefsUrl}`}\n`;
  return { subject: `${copy.prefix}: ${heading}`, html, text };
}

/**
 * The queue's sender: (to, notification, idempotencyKey, user) -> { ok, providerId } or
 * { ok: false, error: { name } }. Never throws. `client` is injectable for tests.
 */
function createEmailSender({ env = process.env, client = null, timeoutMs = TIMEOUT_MS } = {}) {
  return async function send(to, notification, idempotencyKey, user) {
    const config = readConfig(env);
    if (!config.ok) return { ok: false, error: { name: config.reason } };
    const message = renderNotificationEmail({ name: user && user.name, title: notification.title, message: notification.message, category: notification.category, href: notification.metadata && notification.metadata.href, appBaseUrl: config.appBaseUrl });
    let timer;
    try {
      const resend = client || new (require('resend').Resend)(config.apiKey);
      const sending = resend.emails.send({ from: config.from, to: [to], subject: message.subject, html: message.html, text: message.text }, { idempotencyKey });
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('__timeout__'), timeoutMs); });
      const result = await Promise.race([sending, timeout]);
      if (result === '__timeout__') {
        sending.catch(() => {});
        return { ok: false, error: { name: 'timeout' } };
      }
      if (result && result.error) return { ok: false, error: { name: typeof result.error.name === 'string' ? result.error.name : 'unknown' } };
      return { ok: true, providerId: result && result.data && typeof result.data.id === 'string' ? result.data.id : null };
    } catch {
      return { ok: false, error: { name: 'exception' } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

module.exports = { createEmailSender, readConfig, renderNotificationEmail };
