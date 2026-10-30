'use strict';

/**
 * Field checks for public signup (POST /api/auth/signup), made before the rate limits count and
 * before any lookup. The password rule is the same as for password reset (lib/password-policy.js).
 */

const { isValidEmail, normalizeEmail } = require('./email-address');
const { checkNewPassword } = require('./password-policy');

const NAME_MAX_CHARS = 100;

function refuse(error, code) {
  return { ok: false, status: 400, error, code };
}

/** Returns { ok: true, email, name } (normalized) or { ok: false, status: 400, error, code }. */
function checkSignupFields({ email, password, name }) {
  if (typeof email !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
    return refuse('Name, email, and password are required', 'missing_fields');
  }
  const emailNorm = normalizeEmail(email);
  if (!isValidEmail(emailNorm)) return refuse('Enter a valid email address.', 'invalid_email');

  const nameTrim = name.trim().replace(/\s+/g, ' ');
  if (!nameTrim || [...nameTrim].length > NAME_MAX_CHARS || /[\u0000-\u001f\u007f<>]/.test(nameTrim)) {
    return refuse(`Enter your name (up to ${NAME_MAX_CHARS} characters, without < or >).`, 'invalid_name');
  }

  const policy = checkNewPassword(password);
  if (!policy.ok) return refuse(policy.error, policy.code);

  return { ok: true, email: emailNorm, name: nameTrim };
}

module.exports = { NAME_MAX_CHARS, checkSignupFields };
