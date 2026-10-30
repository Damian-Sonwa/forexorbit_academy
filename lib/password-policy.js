'use strict';

/**
 * Password rule for setting a new password through recovery: at least 8 characters and at most
 * 72 bytes. bcrypt only reads the first 72 bytes, so a longer password would be silently
 * truncated; it is refused instead. Characters are counted as code points, so an emoji is one.
 * Runs on the server and in the browser (reset page), so it uses TextEncoder rather than Buffer.
 */

const PASSWORD_MIN_CHARS = 8;
const PASSWORD_MAX_BYTES = 72;

const WEAK_PASSWORD = `Use a password of at least ${PASSWORD_MIN_CHARS} characters.`;
const LONG_PASSWORD = `That password is too long. Use at most ${PASSWORD_MAX_BYTES} bytes (about ${PASSWORD_MAX_BYTES} plain characters).`;

/** Returns { ok: true } or { ok: false, code: 'weak_password', error }. */
function checkNewPassword(password) {
  if (typeof password !== 'string' || [...password].length < PASSWORD_MIN_CHARS || !password.trim()) {
    return { ok: false, code: 'weak_password', error: WEAK_PASSWORD };
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return { ok: false, code: 'weak_password', error: LONG_PASSWORD };
  }
  return { ok: true };
}

module.exports = { PASSWORD_MAX_BYTES, PASSWORD_MIN_CHARS, checkNewPassword };
