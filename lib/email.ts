/**
 * Account email through [Resend](https://resend.com): password reset links and password changed
 * notices. Server-only (API key); import from pages/api only.
 *
 * Configuration:
 *   RESEND_API_KEY  required to send at all; without it nothing is sent.
 *   RESEND_FROM     sender, e.g. "ForexOrbit Academy <no-reply@your-domain>". Required in
 *                   production; Resend's test sender (@resend.dev) is refused there. Outside
 *                   production it defaults to onboarding@resend.dev, which only delivers to the
 *                   Resend account owner.
 *   APP_BASE_URL    the site origin that links point to. Required in production and must be https
 *                   with no path. Outside production it defaults to http://localhost:3000. Links
 *                   are never built from request headers.
 *
 * Nothing here logs recipients, links, tokens or keys; failures are logged as fixed reason codes.
 * Senders never throw: they resolve to { ok: true } or { ok: false, reason }.
 */

import { Resend } from 'resend';
import { passwordChangedEmail, passwordResetEmail, type PasswordChangeMethod, type RenderedEmail } from './email-templates';

type Env = Record<string, string | undefined>;

export type EmailConfigProblem =
  | 'missing_api_key'
  | 'missing_sender'
  | 'test_sender_in_production'
  | 'missing_app_base_url'
  | 'invalid_app_base_url';
export type EmailConfig = { ok: true; apiKey: string; from: string; appBaseUrl: string } | { ok: false; reason: EmailConfigProblem };
export type EmailResult = { ok: true } | { ok: false; reason: EmailConfigProblem | 'send_failed' | 'timeout' };

export const RESEND_TEST_SENDER = 'onboarding@resend.dev';
export const DEVELOPMENT_APP_BASE_URL = 'http://localhost:3000';
export const EMAIL_SEND_TIMEOUT_MS = 10_000;

/** The site origin, or null if the value is not a bare origin that is allowed here. */
function parseAppBaseUrl(raw: string, production: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && (production || url.protocol !== 'http:')) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

/** Reads and checks the email settings. Production refuses anything that would send a broken or test email. */
export function readEmailConfig(env: Env = process.env): EmailConfig {
  const production = env.NODE_ENV === 'production';
  const apiKey = (env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, reason: 'missing_api_key' };

  const from = (env.RESEND_FROM || '').trim() || (production ? '' : RESEND_TEST_SENDER);
  if (!from) return { ok: false, reason: 'missing_sender' };
  if (production && /@resend\.dev\s*>?\s*$/i.test(from)) return { ok: false, reason: 'test_sender_in_production' };

  const rawBase = (env.APP_BASE_URL || '').trim() || (production ? '' : DEVELOPMENT_APP_BASE_URL);
  if (!rawBase) return { ok: false, reason: 'missing_app_base_url' };
  const appBaseUrl = parseAppBaseUrl(rawBase, production);
  if (!appBaseUrl) return { ok: false, reason: 'invalid_app_base_url' };

  return { ok: true, apiKey, from, appBaseUrl };
}

/** Whether a password reset email could be sent now. Checked before a reset link is created. */
export function passwordResetEmailReady(env: Env = process.env): { ok: true } | { ok: false; reason: EmailConfigProblem } {
  const config = readEmailConfig(env);
  return config.ok ? { ok: true } : { ok: false, reason: config.reason };
}

/** The reset page with the token in the fragment, which browsers never send to a server. */
export function buildPasswordResetUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl}/reset-password#token=${encodeURIComponent(token)}`;
}

const TIMED_OUT = Symbol('timed out');

async function deliver(
  config: Extract<EmailConfig, { ok: true }>,
  to: string,
  message: RenderedEmail,
  { kind, idempotencyKey, timeoutMs }: { kind: string; idempotencyKey: string; timeoutMs: number }
): Promise<EmailResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const resend = new Resend(config.apiKey);
    const sending = resend.emails.send(
      { from: config.from, to: [to], subject: message.subject, html: message.html, text: message.text },
      { idempotencyKey }
    );
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });
    const result = await Promise.race([sending, timeout]);
    if (result === TIMED_OUT) {
      // The send may still complete; the idempotency key stops a retry from sending it twice.
      sending.catch(() => {});
      console.warn(JSON.stringify({ event: 'email_not_sent', kind, reason: 'timeout' }));
      return { ok: false, reason: 'timeout' };
    }
    if (result.error) {
      const name = typeof result.error.name === 'string' ? result.error.name : 'unknown';
      console.warn(JSON.stringify({ event: 'email_not_sent', kind, reason: 'send_failed', provider: name }));
      return { ok: false, reason: 'send_failed' };
    }
    return { ok: true };
  } catch {
    console.warn(JSON.stringify({ event: 'email_not_sent', kind, reason: 'send_failed' }));
    return { ok: false, reason: 'send_failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type SendOptions = { env?: Env; timeoutMs?: number };

/** Emails a password reset link. `idempotencyKey` must identify the link (one key per link). */
export async function sendPasswordResetEmail(
  input: { to: string; name?: unknown; token: string; expiresAt: Date; idempotencyKey: string },
  { env = process.env, timeoutMs = EMAIL_SEND_TIMEOUT_MS }: SendOptions = {}
): Promise<EmailResult> {
  const config = readEmailConfig(env);
  if (!config.ok) {
    console.warn(JSON.stringify({ event: 'email_not_sent', kind: 'password_reset', reason: config.reason }));
    return { ok: false, reason: config.reason };
  }
  const minutes = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 60000));
  const message = passwordResetEmail({
    name: input.name,
    resetUrl: buildPasswordResetUrl(config.appBaseUrl, input.token),
    expiresInMinutes: minutes,
  });
  return deliver(config, input.to, message, { kind: 'password_reset', idempotencyKey: input.idempotencyKey, timeoutMs });
}

/** Tells the account holder their password was changed (by reset link, or in account settings). */
export async function sendPasswordChangedEmail(
  input: { to: string; name?: unknown; idempotencyKey: string; method?: PasswordChangeMethod },
  { env = process.env, timeoutMs = EMAIL_SEND_TIMEOUT_MS }: SendOptions = {}
): Promise<EmailResult> {
  const config = readEmailConfig(env);
  if (!config.ok) {
    console.warn(JSON.stringify({ event: 'email_not_sent', kind: 'password_changed', reason: config.reason }));
    return { ok: false, reason: config.reason };
  }
  const message = passwordChangedEmail({
    name: input.name,
    forgotPasswordUrl: `${config.appBaseUrl}/forgot-password`,
    method: input.method,
  });
  return deliver(config, input.to, message, { kind: 'password_changed', idempotencyKey: input.idempotencyKey, timeoutMs });
}
