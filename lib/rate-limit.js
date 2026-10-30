'use strict';

/**
 * Fixed-window limiter held in process memory. Each server instance counts separately,
 * so the effective limit across several instances is a multiple of `max`.
 *
 * `maxKeys` bounds memory when callers count many distinct keys (for example one per email):
 * expired windows are dropped first, then the oldest windows. Without it the map is pruned of
 * expired windows only, as before.
 */
function createRateLimiter({ windowMs, max, maxKeys = Infinity }) {
  const hits = new Map();
  const pruneAt = Math.min(10000, maxKeys);

  function prune(now) {
    for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    // Map iteration is insertion order, so this drops the oldest windows first.
    for (const k of hits.keys()) {
      if (hits.size < maxKeys) break;
      hits.delete(k);
    }
  }

  function check(key, now = Date.now()) {
    const entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      if (entry) hits.delete(key);
      if (hits.size >= pruneAt) prune(now);
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    if (entry.count >= max) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    entry.count += 1;
    return { allowed: true, retryAfterSec: 0 };
  }

  return { check, size: () => hits.size };
}

module.exports = { createRateLimiter };
