export type RateLimitDecision = { allowed: boolean; retryAfterSec: number };
export function createRateLimiter(options: { windowMs: number; max: number; maxKeys?: number }): {
  check(key: string, now?: number): RateLimitDecision;
  size(): number;
};
