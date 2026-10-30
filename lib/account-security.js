'use strict';

/**
 * Signed-in account security: changing the password and signing out of every device.
 *
 * Sessions are JWTs bound to the account's sessionGeneration (lib/token-core.js); raising it ends
 * every session at its next request or socket event. There is no per-session store, so "sign out
 * of this device" stays a browser-side action and "sign out everywhere" ends all sessions.
 *
 * Failures that mean "wrong current password" are 400, not 401: the browser client treats 401 as
 * an ended session and signs the user out.
 */

const { ObjectId } = require('mongodb');
const { decideAccountAccess } = require('./account-access');
const { checkNewPassword } = require('./password-policy');

const SECURITY_LOG_COLLECTION = 'passwordResetSecurityLogs';
const CURRENT_PASSWORD_MAX_CHARS = 1024;

const storedValue = (value) => (value === undefined ? null : value);
const generationOf = (user) => (Number.isInteger(user.sessionGeneration) ? user.sessionGeneration : 0);

function refuse(status, error, code) {
  return { ok: false, status, error, code };
}

async function logSecurityEvent(db, event, { userId, ip, detail } = {}) {
  try {
    await db.collection(SECURITY_LOG_COLLECTION).insertOne({
      event,
      ...(userId ? { userId } : {}),
      ...(ip ? { ip } : {}),
      ...(detail ? { detail } : {}),
      createdAt: new Date(),
    });
  } catch {
    console.error('[account-security] security log write failed');
  }
}

/**
 * Checks the current password, applies the password rule, stores the new hash and raises
 * sessionGeneration in one conditional update (only if the password and sessions are unchanged
 * since they were read). Resolves to { ok: true, user, generation } with the new generation, so
 * the caller can issue a fresh token for the current device, or to a refusal.
 */
async function changePassword(db, { userId, currentPassword, newPassword, compare, hash, ip, now = new Date() }) {
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > CURRENT_PASSWORD_MAX_CHARS) {
    return refuse(400, 'Enter your current password.', 'current_password_required');
  }
  const policy = checkNewPassword(newPassword);
  if (!policy.ok) return refuse(400, policy.error, policy.code);

  const users = db.collection('users');
  const _id = new ObjectId(String(userId));
  const user = await users.findOne(
    { _id },
    { projection: { password: 1, status: 1, role: 1, email: 1, name: 1, sessionGeneration: 1 } }
  );
  const access = user ? decideAccountAccess({ userId: String(_id), record: user }) : { ok: false, status: 401, error: 'Authentication required' };
  if (!access.ok) return refuse(access.status, access.error, 'account_not_active');
  if (typeof user.password !== 'string' || !user.password) {
    return refuse(400, 'Your current password is not correct.', 'wrong_password');
  }

  if (!(await compare(currentPassword, user.password))) {
    await logSecurityEvent(db, 'password_change_refused', { userId: _id, ip, detail: 'wrong_password' });
    return refuse(400, 'Your current password is not correct.', 'wrong_password');
  }
  if (await compare(newPassword, user.password)) {
    return refuse(400, 'Choose a new password that is different from your current one.', 'same_password');
  }

  const password = await hash(newPassword);
  const updated = await users.updateOne(
    { _id, password: user.password, sessionGeneration: storedValue(user.sessionGeneration) },
    { $set: { password, updatedAt: now }, $inc: { sessionGeneration: 1 } }
  );
  if (!updated.matchedCount) {
    return refuse(409, 'Your account changed while this was being saved. Sign in again and retry.', 'concurrent_change');
  }
  await logSecurityEvent(db, 'password_changed', { userId: _id, ip });
  return {
    ok: true,
    status: 200,
    generation: generationOf(user) + 1,
    user: { id: String(_id), email: user.email, name: user.name, role: user.role },
  };
}

/** Ends every session of the account, including the caller's. */
async function signOutEverywhere(db, { userId, ip }) {
  const _id = new ObjectId(String(userId));
  const updated = await db.collection('users').updateOne({ _id }, { $inc: { sessionGeneration: 1 } });
  if (!updated.matchedCount) return refuse(404, 'Account not found', 'not_found');
  await logSecurityEvent(db, 'signed_out_everywhere', { userId: _id, ip });
  return { ok: true, status: 200 };
}

module.exports = { CURRENT_PASSWORD_MAX_CHARS, SECURITY_LOG_COLLECTION, changePassword, signOutEverywhere };
