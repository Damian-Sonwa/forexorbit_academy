export type RateLimitDecision = { allowed: boolean; retryAfterSec: number };
export function createRateLimiter(options: { windowMs: number; max: number }): {
  check(key: string, now?: number): RateLimitDecision;
};
