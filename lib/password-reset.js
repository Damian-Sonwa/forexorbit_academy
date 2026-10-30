'use strict';

/**
 * Password reset by email (POST /api/auth/forgot-password and POST /api/auth/reset-password).
 *
 * Request: every valid email address gets the same 200 response, never sooner than
 * `minResponseMs`, whether or not it belongs to an account. A link is created and emailed only
 * for exactly one active account with that address. If the email cannot be sent the link is
 * removed again, so no working link exists that nobody received.
 *
 * Completion: the token is claimed once, atomically (lib/password-reset-token.js). The account
 * must still be active and its sessions unchanged since the link was sent. The new password is
 * stored with bcrypt and sessionGeneration is raised in the same update, which signs out every
 * existing session (auth middleware and socket handshake). Other live links for the account are
 * replaced, and a password changed notice is emailed.
 *
 * Rate limits (lib/auth-rate-limit.js) are counted before any account lookup, in this process and,
 * with SHARED_RATE_LIMIT=mongodb, in the shared store; an unreachable store refuses with 503.
 * Security log entries hold event names, account ids and client addresses, never email addresses,
 * tokens or links.
 */

const bcrypt = require('bcryptjs');
const { performance } = require('perf_hooks');
const { decideAccountAccess } = require('./account-access');
const {
  RESET_COMPLETE_RULES,
  RESET_COOLDOWN_RULES,
  RESET_COOLDOWN_WINDOW_MS,
  RESET_REQUEST_RULES,
  createAuthLimiter,
  normalizeEmail,
} = require('./auth-rate-limit');
const { checkNewPassword } = require('./password-policy');
const {
  LINK_REFUSALS,
  RESET_TOKEN_TTL_MS,
  claimResetToken,
  discardResetToken,
  hashResetToken,
  isWellFormedToken,
  issueResetToken,
  supersedeActiveTokens,
} = require('./password-reset-token');

const SECURITY_LOG_COLLECTION = 'passwordResetSecurityLogs';
const MIN_RESPONSE_MS = 1200;
const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESET_REQUESTED = `If an account exists for that email, we have sent a link to reset your password. The link expires in ${Math.round(RESET_TOKEN_TTL_MS / 60000)} minutes.`;
const RESET_COMPLETE = 'Your password has been reset. Sign in with your new password.';
const INVALID_EMAIL = 'Enter a valid email address.';

const USER_PROJECTION = { email: 1, name: 1, role: 1, status: 1, sessionGeneration: 1 };

function isValidEmail(email) {
  return email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email) && !/[\u0000-\u001f\u007f]/.test(email);
}

/** The generation tokens are bound to; a missing counter is generation 0 (lib/token-core.js). */
function generationOf(user) {
  return Number.isInteger(user.sessionGeneration) ? user.sessionGeneration : 0;
}

/** Matches the stored value exactly; null also matches a missing field. */
const storedValue = (value) => (value === undefined ? null : value);

function linkRefusal(code) {
  return { status: 400, body: { error: LINK_REFUSALS[code], code } };
}

/**
 * `mailer` provides passwordResetEmailReady(env), sendPasswordResetEmail(input, { env }) and
 * sendPasswordChangedEmail(input, { env }) (lib/email.ts). Results have the shape
 * { status, body } or { refusal } (a rate-limit decision for sendRefusal).
 */
function createPasswordResetService({
  getDb,
  mailer,
  env = process.env,
  minResponseMs = MIN_RESPONSE_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = () => performance.now(),
  hashPassword = (password) => bcrypt.hash(password, 10),
}) {
  const requestLimiter = createAuthLimiter(RESET_REQUEST_RULES);
  const cooldownLimiter = createAuthLimiter(RESET_COOLDOWN_RULES, { windowMs: RESET_COOLDOWN_WINDOW_MS });
  const completeLimiter = createAuthLimiter(RESET_COMPLETE_RULES);

  async function log(db, event, { userId, ip, detail } = {}) {
    try {
      await db.collection(SECURITY_LOG_COLLECTION).insertOne({
        event,
        ...(userId ? { userId } : {}),
        ...(ip ? { ip } : {}),
        ...(detail ? { detail } : {}),
        createdAt: new Date(),
      });
    } catch {
      console.error('[password-reset] security log write failed');
    }
  }

  /** Creates and emails a link if the address belongs to exactly one active account. */
  async function sendLinkIfEligible(email, ip) {
    const db = await getDb();
    const matches = await db.collection('users').find({ email }, { projection: USER_PROJECTION }).limit(2).toArray();
    if (matches.length === 0) return log(db, 'reset_requested', { ip, detail: 'no_account' });
    // Two accounts with one address: refuse rather than guess which one to reset.
    if (matches.length > 1) return log(db, 'reset_refused', { ip, detail: 'ambiguous_email' });

    const user = matches[0];
    const access = decideAccountAccess({ userId: String(user._id), record: user });
    if (!access.ok) return log(db, 'reset_refused', { userId: user._id, ip, detail: 'account_not_active' });

    const ready = mailer.passwordResetEmailReady(env);
    if (!ready.ok) return log(db, 'reset_email_not_sent', { userId: user._id, ip, detail: ready.reason });

    const link = await issueResetToken(db, { userId: user._id, sessionGeneration: generationOf(user), now: new Date() });
    const sent = await mailer.sendPasswordResetEmail(
      { to: user.email, name: user.name, token: link.token, expiresAt: link.expiresAt, idempotencyKey: `password-reset/${link.id}` },
      { env }
    );
    if (!sent.ok) {
      await discardResetToken(db, link.id);
      return log(db, 'reset_email_not_sent', { userId: user._id, ip, detail: sent.reason });
    }
    return log(db, 'reset_email_sent', { userId: user._id, ip });
  }

  async function requestReset({ body, ip }) {
    const started = clock();
    const email = normalizeEmail(body && typeof body === 'object' ? body.email : undefined);
    if (!isValidEmail(email)) return { status: 400, body: { error: INVALID_EMAIL, code: 'invalid_email' } };

    // Counted for every valid address before any lookup, so a refusal says nothing about accounts.
    const limit = await requestLimiter.consume({ ip, email, getDb, env });
    if (!limit.allowed) return { refusal: limit };
    // One email per address per minute, counted atomically: simultaneous requests send one link.
    const gate = await cooldownLimiter.consume({ ip: null, email, getDb, env });
    if (!gate.allowed && gate.status === 503) return { refusal: gate };
    if (gate.allowed) await sendLinkIfEligible(email, ip);

    const remaining = minResponseMs - (clock() - started);
    if (remaining > 0) await sleep(remaining);
    return { status: 200, body: { message: RESET_REQUESTED } };
  }

  async function completeReset({ body, ip }) {
    const input = body && typeof body === 'object' ? body : {};
    const token = typeof input.token === 'string' ? input.token.trim() : '';
    if (!isWellFormedToken(token)) return linkRefusal('invalid_token');
    // Checked before the link is used, so a rejected password does not spend it.
    const policy = checkNewPassword(input.password);
    if (!policy.ok) return { status: 400, body: { error: policy.error, code: policy.code } };

    const limit = await completeLimiter.consume({ ip, ticket: hashResetToken(token), getDb, env });
    if (!limit.allowed) return { refusal: limit };

    const db = await getDb();
    const now = new Date();
    const claim = await claimResetToken(db, { token, now });
    if (!claim.ok) {
      await log(db, 'reset_link_refused', { ip, detail: claim.code });
      return linkRefusal(claim.code);
    }
    const link = claim.record;

    const users = db.collection('users');
    const user = await users.findOne({ _id: link.userId }, { projection: USER_PROJECTION });
    const access = user ? decideAccountAccess({ userId: String(user._id), record: user }) : { ok: false };
    if (!access.ok) {
      await log(db, 'reset_refused', { userId: link.userId, ip, detail: 'account_not_active' });
      return linkRefusal('invalid_token');
    }
    if (generationOf(user) !== link.sessionGeneration) {
      await log(db, 'reset_refused', { userId: user._id, ip, detail: 'sessions_changed' });
      return linkRefusal('invalid_token');
    }

    const password = await hashPassword(input.password);
    // Applies only if the account is exactly as checked: still active, sessions unchanged.
    const updated = await users.updateOne(
      { _id: user._id, status: storedValue(user.status), sessionGeneration: storedValue(user.sessionGeneration) },
      { $set: { password, updatedAt: now }, $inc: { sessionGeneration: 1 } }
    );
    if (!updated.matchedCount) {
      await log(db, 'reset_refused', { userId: user._id, ip, detail: 'account_changed' });
      return linkRefusal('invalid_token');
    }

    await supersedeActiveTokens(db, user._id, now);
    await log(db, 'password_reset_complete', { userId: user._id, ip });
    const notice = await mailer.sendPasswordChangedEmail(
      { to: user.email, name: user.name, idempotencyKey: `password-changed/${link._id}` },
      { env }
    );
    if (!notice.ok) await log(db, 'password_changed_email_not_sent', { userId: user._id, detail: notice.reason });

    return { status: 200, body: { message: RESET_COMPLETE } };
  }

  return { requestReset, completeReset };
}

module.exports = {
  INVALID_EMAIL,
  MIN_RESPONSE_MS,
  RESET_COMPLETE,
  RESET_REQUESTED,
  SECURITY_LOG_COLLECTION,
  createPasswordResetService,
  isValidEmail,
};
