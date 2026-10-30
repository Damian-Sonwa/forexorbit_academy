'use strict';

/**
 * Email address rules shared by signup, login and password reset. Addresses are stored and looked
 * up trimmed and lower-cased (normalizeEmail, the same function the auth rate limits key on).
 */

const { normalizeEmail } = require('./auth-rate-limit');

const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** For an already normalized address: one @, a dot in the domain, no spaces or control characters. */
function isValidEmail(email) {
  return (
    typeof email === 'string' &&
    email.length > 0 &&
    email.length <= EMAIL_MAX_LENGTH &&
    EMAIL_PATTERN.test(email) &&
    !/[\u0000-\u001f\u007f]/.test(email)
  );
}

module.exports = { EMAIL_MAX_LENGTH, isValidEmail, normalizeEmail };
