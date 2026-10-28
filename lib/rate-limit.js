'use strict';

/**
 * Fixed-window limiter held in process memory. Each server instance counts separately,
 * so the effective limit across several instances is a multiple of `max`.
 */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  function check(key, now = Date.now()) {
    const entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10000) {
        for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
      }
      return { allowed: true, retryAfterSec: 0 };
    }
    if (entry.count >= max) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    entry.count += 1;
    return { allowed: true, retryAfterSec: 0 };
  }

  return { check };
}

module.exports = { createRateLimiter };
