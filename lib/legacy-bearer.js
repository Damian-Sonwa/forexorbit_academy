'use strict';

/**
 * TEMPORARY (Phase 4.5 rollout only; delete after the window, see docs/phase-4-5/rollout-plan.md).
 *
 * Before Phase 4.5 the browser kept a 7-day JWT in localStorage. During a short window after the
 * release, POST /api/auth/session/upgrade exchanges such a token, once, for a cookie session, so
 * people who were signed in are not all signed out at once. No other route accepts a bearer token.
 *
 * The window is open only while AUTH_LEGACY_BEARER_UNTIL is a valid ISO date in the future and not
 * later than LEGACY_BEARER_HARD_STOP. Unset (the default everywhere) means closed. After the hard
 * stop the window is closed whatever the setting says, so the path cannot stay open by accident.
 */

const LEGACY_BEARER_HARD_STOP = '2027-01-31T00:00:00.000Z';

function legacyBearerWindow(env = process.env, now = new Date()) {
  const raw = String(env.AUTH_LEGACY_BEARER_UNTIL || '').trim();
  if (!raw) return { open: false, reason: 'not_configured' };
  const until = new Date(raw);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(until.getTime())) return { open: false, reason: 'invalid_setting' };
  if (until.getTime() > new Date(LEGACY_BEARER_HARD_STOP).getTime()) return { open: false, reason: 'beyond_hard_stop' };
  if (now.getTime() >= until.getTime()) return { open: false, reason: 'ended' };
  return { open: true, until };
}

module.exports = { LEGACY_BEARER_HARD_STOP, legacyBearerWindow };
