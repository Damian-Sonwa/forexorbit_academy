'use strict';

/**
 * Fixed-window rate limit counted in MongoDB, so every server instance shares one count (D10).
 * Each window is one document whose `_id` names the scope, the caller and the window start; the
 * count is raised with a single atomic upsert. A TTL index on `expiresAt` (see
 * RATE_LIMIT_TTL_INDEX) removes finished windows; without it they only accumulate.
 */

const RATE_LIMIT_COLLECTION = 'rateLimits';

const RATE_LIMIT_TTL_INDEX = Object.freeze({
  id: 'R1',
  collection: RATE_LIMIT_COLLECTION,
  key: { expiresAt: 1 },
  options: { name: 'ttl_rate_limit_window', expireAfterSeconds: 0 },
});

/**
 * The shared count is used only when SHARED_RATE_LIMIT=mongodb, which the owner sets after R1 is
 * built. Until then routes keep their per-process limit, so a deploy never depends on R1.
 */
let warnedAbout = null;

function sharedLimitEnabled(env = process.env) {
  const value = String(env.SHARED_RATE_LIMIT || '').trim().toLowerCase();
  if (value === 'mongodb') return true;
  // A mistyped value would otherwise turn the shared count off without any sign of it.
  if (value && value !== warnedAbout) {
    warnedAbout = value;
    console.warn('[rate-limit] SHARED_RATE_LIMIT is set but not to "mongodb"; counting per process only.');
  }
  return false;
}

function isDuplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));
}

/**
 * Counts one request for `key` in `scope` and reports whether it is within `max` per `windowMs`.
 * Throws when the store cannot be reached; callers must then refuse the request.
 */
async function consumeSharedLimit(db, { scope, key, windowMs, max, now = Date.now() }) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const id = `${scope}:${key}:${windowStart}`;
  const col = db.collection(RATE_LIMIT_COLLECTION);
  let doc = null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      doc = await col.findOneAndUpdate(
        { _id: id },
        { $inc: { count: 1 }, $setOnInsert: { scope, expiresAt: new Date(resetAt) } },
        { upsert: true, returnDocument: 'after', includeResultMetadata: false }
      );
      break;
    } catch (error) {
      if (!isDuplicateKey(error) || attempt > 0) throw error;
    }
  }
  const count = doc && Number.isFinite(doc.count) ? doc.count : Infinity;
  if (count <= max) return { allowed: true, retryAfterSec: 0 };
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
}

module.exports = { RATE_LIMIT_COLLECTION, RATE_LIMIT_TTL_INDEX, consumeSharedLimit, sharedLimitEnabled };
