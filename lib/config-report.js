'use strict';

/**
 * Startup configuration report (Phase 15). Required settings are already enforced in server.js
 * (database URI, JWT secret, canonical app origin). This reports the optional integrations so an
 * operator can see at a glance, in the first log lines, which features will degrade. It names
 * variables and says configured or not; it never logs a value.
 */

const INTEGRATIONS = Object.freeze([
  { id: 'payments', label: 'Paystack payments', vars: ['PAYSTACK_SECRET_KEY'], impact: 'checkout and payment webhooks fail' },
  { id: 'email', label: 'Resend email', vars: ['RESEND_API_KEY', 'RESEND_FROM', 'APP_BASE_URL'], impact: 'password reset and notification emails are not sent' },
  { id: 'emailWebhook', label: 'Resend delivery webhook', vars: ['RESEND_WEBHOOK_SECRET'], impact: 'delivery and bounce tracking stop at "sent"' },
  { id: 'storage', label: 'Cloudinary storage', vars: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], impact: 'uploads, chat attachments and task evidence are unavailable' },
  { id: 'push', label: 'Browser push (VAPID)', vars: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'], impact: 'push is off; in-app and email still work' },
  { id: 'video', label: 'Agora video', vars: [['AGORA_APP_ID', 'NEXT_PUBLIC_AGORA_APP_ID'], 'AGORA_APP_CERTIFICATE'], impact: 'video consultations cannot start' },
  { id: 'ai', label: 'AI assistant', vars: ['AI_API_KEY'], impact: 'AI features are disabled' },
]);

const present = (env, name) => (Array.isArray(name) ? name.some((n) => present(env, n)) : typeof env[name] === 'string' && env[name].trim() !== '');

function configReport(env = process.env) {
  return INTEGRATIONS.map((i) => {
    const missing = i.vars.filter((v) => !present(env, v)).map((v) => (Array.isArray(v) ? v.join(' or ') : v));
    return { id: i.id, label: i.label, configured: missing.length === 0, missing, impact: missing.length ? i.impact : null };
  });
}

/** One structured log line for the startup log. */
function configReportLine(env = process.env) {
  const rows = configReport(env);
  return JSON.stringify({ event: 'configReport', configured: rows.filter((r) => r.configured).map((r) => r.id), notConfigured: rows.filter((r) => !r.configured).map((r) => ({ id: r.id, missing: r.missing, impact: r.impact })) });
}

module.exports = { INTEGRATIONS, configReport, configReportLine };
