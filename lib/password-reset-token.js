'use strict';

/**
 * Password-reset links sent by email (lib/password-reset.js).
 *
 * A link carries a 256-bit random token. Only its SHA-256 hash is stored, so the database never
 * holds a usable link; a fast hash is enough because the token itself cannot be guessed. Each
 * record is one link: `active` until it is used (`used`) or replaced by a newer link for the same
 * account (`superseded`). Claiming is one conditional update, so of any number of simultaneous
 * requests with the same token exactly one succeeds. Records stay for a day after they expire, so
 * the page can still tell someone a link expired or was used, and are then removed by the TTL index.
 */

const crypto = require('crypto');

const RESET_TOKENS_COLLECTION = 'passwordResetTokens';
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_TOKEN_RETENTION_SECONDS = 24 * 60 * 60;
const RESET_TOKEN_BYTES = 32;
/** Inserts tried when simultaneous requests for one account collide on index T2. */
const ISSUE_ATTEMPTS = 5;
/** base64url of 32 bytes: 43 characters, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Built by scripts/password-reset-indexes.js. The code works without them; they are guarantees and cleanup. */
const RESET_TOKEN_INDEXES = Object.freeze([
  Object.freeze({
    id: 'T1',
    collection: RESET_TOKENS_COLLECTION,
    key: { tokenHash: 1 },
    options: { name: 'uniq_reset_token_hash', unique: true },
  }),
  Object.freeze({
    id: 'T2',
    collection: RESET_TOKENS_COLLECTION,
    key: { userId: 1 },
    options: { name: 'uniq_active_reset_per_user', unique: true, partialFilterExpression: { status: 'active' } },
  }),
  Object.freeze({
    id: 'T3',
    collection: RESET_TOKENS_COLLECTION,
    key: { expiresAt: 1 },
    options: { name: 'ttl_reset_token_expiry', expireAfterSeconds: RESET_TOKEN_RETENTION_SECONDS },
  }),
]);

const LINK_REFUSALS = Object.freeze({
  invalid_token: 'This reset link is not valid. Request a new link to reset your password.',
  expired_token: 'This reset link has expired. Request a new link to reset your password.',
  used_token: 'This reset link has already been used. Request a new link if you still need to reset your password.',
  superseded_token: 'A newer reset link has been sent. Use the most recent email, or request a new link.',
});

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function isWellFormedToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

function isDuplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));
}

/** Marks every live link for the account as replaced. */
async function supersedeActiveTokens(db, userId, now) {
  await db.collection(RESET_TOKENS_COLLECTION).updateMany(
    { userId, status: 'active' },
    { $set: { status: 'superseded', supersededAt: now } }
  );
}

/**
 * Replaces any live link for the account with a new one and returns the raw token, which is sent
 * by email and never stored. `sessionGeneration` is recorded so a link stops working if the
 * account's sessions are reset some other way before it is used.
 */
async function issueResetToken(db, { userId, sessionGeneration, now = new Date() }) {
  const col = db.collection(RESET_TOKENS_COLLECTION);
  for (let attempt = 1; ; attempt += 1) {
    await supersedeActiveTokens(db, userId, now);
    const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('base64url');
    const doc = {
      userId,
      tokenHash: hashResetToken(token),
      status: 'active',
      sessionGeneration,
      createdAt: now,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
    };
    try {
      const { insertedId } = await col.insertOne(doc);
      return { id: insertedId, token, expiresAt: doc.expiresAt };
    } catch (error) {
      // A simultaneous request inserted a live link first (index T2): replace it and try again.
      if (!isDuplicateKey(error) || attempt >= ISSUE_ATTEMPTS) throw error;
    }
  }
}

/** Removes a link that could not be emailed, so no working link is left that nobody received. */
async function discardResetToken(db, id) {
  await db.collection(RESET_TOKENS_COLLECTION).deleteOne({ _id: id, status: 'active' });
}

/**
 * Uses a link once. Resolves to { ok: true, record } for exactly one caller per token, or
 * { ok: false, code } naming why the link cannot be used.
 */
async function claimResetToken(db, { token, now = new Date() }) {
  const col = db.collection(RESET_TOKENS_COLLECTION);
  const tokenHash = hashResetToken(token);
  const record = await col.findOneAndUpdate(
    { tokenHash, status: 'active', expiresAt: { $gt: now } },
    { $set: { status: 'used', usedAt: now } },
    { returnDocument: 'after', includeResultMetadata: false }
  );
  if (record) return { ok: true, record };

  const seen = await col.findOne({ tokenHash }, { projection: { status: 1, expiresAt: 1 } });
  if (!seen) return { ok: false, code: 'invalid_token' };
  if (seen.status === 'used') return { ok: false, code: 'used_token' };
  if (seen.status === 'superseded') return { ok: false, code: 'superseded_token' };
  if (seen.status === 'active') return { ok: false, code: 'expired_token' };
  return { ok: false, code: 'invalid_token' };
}

module.exports = {
  LINK_REFUSALS,
  RESET_TOKENS_COLLECTION,
  RESET_TOKEN_INDEXES,
  RESET_TOKEN_RETENTION_SECONDS,
  RESET_TOKEN_TTL_MS,
  claimResetToken,
  discardResetToken,
  hashResetToken,
  isWellFormedToken,
  issueResetToken,
  supersedeActiveTokens,
};
