/**
 * Signup duplicate handling.
 * Email and phone collisions share one response so the caller cannot tell which value is taken.
 * Status 400 means no account was created.
 */

const SIGNUP_CONFLICT = {
  status: 400,
  body: {
    error: 'An account could not be created with those details. If you already registered, sign in.',
  },
};

function signupConflict(existingEmail, existingPhone) {
  if (existingEmail || existingPhone) return SIGNUP_CONFLICT;
  return null;
}

function isDuplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));
}

module.exports = {
  SIGNUP_CONFLICT,
  signupConflict,
  isDuplicateKey,
};
