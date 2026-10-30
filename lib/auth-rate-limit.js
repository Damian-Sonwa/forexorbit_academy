'use strict';

/**
 * Rate limits for the authentication routes: login and signup (H1) and the two password-reset
 * steps (requesting a link by email and setting the new password).
 *
 * Every attempt counts, before any user lookup, password hash or insert. Windows are fixed and
 * short (10 minutes), so throttling always ends by itself; nothing is stored on the account and no
 * account is ever locked.
 *
 * Each rule is counted in this process and, when SHARED_RATE_LIMIT=mongodb is set (after the R1
 * TTL index exists), in the shared MongoDB store so every server instance shares one count. If the
 * shared store cannot be reached the request is refused (503): sign-in and sign-up read the same
 * database, so they could not complete anyway, and the limit is never silently skipped.
 *
 * Keys are HMACs of the rule and its inputs (normalized email, client network, reset-token hash),
 * so the store holds no raw emails, addresses or tokens. A rule with no inputs is a service-wide
 * count. Responses are the same whether or not an account exists.
 */

const crypto = require('crypto');
const { createRateLimiter } = require('./rate-limit');
const { consumeSharedLimit, sharedLimitEnabled } = require('./shared-rate-limit');

const WINDOW_MS = 10 * 60 * 1000;

/**
 * Login: per address (one source trying many accounts), per email and address (one source on
 * one account) and per email from anywhere (many sources on one account). The per-email cap is
 * the loosest, so someone elsewhere has to keep up 50 attempts per window to throttle the account
 * owner, and even then only until the window ends.
 */
const LOGIN_RULES = Object.freeze([
  Object.freeze({ id: 'login-ip', max: 30, parts: ['ip'] }),
  Object.freeze({ id: 'login-email-ip', max: 10, parts: ['email', 'ip'] }),
  Object.freeze({ id: 'login-email', max: 50, parts: ['email'] }),
]);

/** Signup: per address (automated account creation) and per email (repeated attempts on one address). */
const SIGNUP_RULES = Object.freeze([
  Object.freeze({ id: 'signup-ip', max: 10, parts: ['ip'] }),
  Object.freeze({ id: 'signup-email', max: 5, parts: ['email'] }),
]);

/**
 * Password reset, step 1 (request a link by email). Rules on the email apply to every valid
 * address, whether or not it has an account, so a refusal reveals nothing. The one-minute
 * cooldown is counted atomically, so simultaneous requests for one address send at most one
 * email. The service-wide cap bounds email volume if many addresses are targeted.
 */
const RESET_REQUEST_RULES = Object.freeze([
  Object.freeze({ id: 'reset-request-ip', max: 10, parts: ['ip'] }),
  Object.freeze({ id: 'reset-request-email', max: 5, parts: ['email'] }),
  Object.freeze({ id: 'reset-request-global', max: 300, parts: [] }),
]);
const RESET_COOLDOWN_RULES = Object.freeze([Object.freeze({ id: 'reset-request-cooldown', max: 1, parts: ['email'] })]);
const RESET_COOLDOWN_WINDOW_MS = 60 * 1000;

/**
 * Password reset, step 2 (set the new password with the link). `ticket` is the token's SHA-256
 * hash. A token cannot be guessed (256 bits); these rules slow repeated use of one link.
 */
const RESET_COMPLETE_RULES = Object.freeze([
  Object.freeze({ id: 'reset-complete-ip', max: 10, parts: ['ip'] }),
  Object.freeze({ id: 'reset-complete-ticket', max: 5, parts: ['ticket'] }),
]);

/** In-process windows kept per rule; the oldest are dropped first, so memory stays bounded. */
const MAX_LOCAL_KEYS = 50000;

const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';
const UNAVAILABLE = 'This service is briefly unavailable. Please try again shortly.';

/** Same normalization as login and signup use for the stored email. */
function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function keyFor(rule, values, secret) {
  const material = rule.parts.map((part) => `${part}=${values[part]}`).join('|');
  const hmacKey = secret || 'forexorbit-auth-rate-limit';
  return crypto.createHmac('sha256', hmacKey).update(`${rule.id}|${material}`).digest('hex').slice(0, 40);
}

function createAuthLimiter(rules, { windowMs = WINDOW_MS } = {}) {
  const local = new Map(rules.map((rule) => [rule.id, createRateLimiter({ windowMs, max: rule.max, maxKeys: MAX_LOCAL_KEYS })]));

  /**
   * Counts one attempt under every rule whose inputs are known. A rule needing the address is
   * skipped when the address is unknown, never counted under a shared fallback key.
   * Resolves to { allowed: true } | { allowed: false, status: 429, retryAfterSec } |
   * { allowed: false, status: 503 }.
   */
  async function consume({ ip, email, ticket, getDb, env = process.env, now = Date.now() }) {
    const text = (value) => (typeof value === 'string' ? value : '');
    const values = { ip: ip || '', email: normalizeEmail(email), ticket: text(ticket) };
    const secret = String(env.JWT_SECRET || '');
    const active = rules
      .filter((rule) => rule.parts.every((part) => values[part]))
      .map((rule) => ({ rule, key: keyFor(rule, values, secret) }));

    let retryAfterSec = 0;
    for (const { rule, key } of active) {
      const decision = local.get(rule.id).check(key, now);
      if (!decision.allowed) retryAfterSec = Math.max(retryAfterSec, decision.retryAfterSec);
    }
    if (retryAfterSec) return { allowed: false, status: 429, retryAfterSec };

    if (sharedLimitEnabled(env) && active.length) {
      let db;
      try {
        db = await getDb();
        const decisions = await Promise.all(
          active.map(({ rule, key }) => consumeSharedLimit(db, { scope: rule.id, key, windowMs, max: rule.max, now }))
        );
        for (const decision of decisions) {
          if (!decision.allowed) retryAfterSec = Math.max(retryAfterSec, decision.retryAfterSec);
        }
      } catch {
        return { allowed: false, status: 503 };
      }
      if (retryAfterSec) return { allowed: false, status: 429, retryAfterSec };
    }
    return { allowed: true };
  }

  return { consume };
}

/** Sends the refusal. Same body for every refused request, whatever the account's state. */
function sendRefusal(res, decision) {
  res.setHeader('Cache-Control', 'no-store');
  if (decision.status === 429) {
    res.setHeader('Retry-After', String(decision.retryAfterSec));
    return res.status(429).json({ error: TOO_MANY, code: 'rate_limited', retryAfterSec: decision.retryAfterSec });
  }
  return res.status(503).json({ error: UNAVAILABLE, code: 'rate_limit_unavailable' });
}

module.exports = {
  LOGIN_RULES,
  MAX_LOCAL_KEYS,
  RESET_COMPLETE_RULES,
  RESET_COOLDOWN_RULES,
  RESET_COOLDOWN_WINDOW_MS,
  RESET_REQUEST_RULES,
  SIGNUP_RULES,
  WINDOW_MS,
  createAuthLimiter,
  keyFor,
  normalizeEmail,
  sendRefusal,
};
