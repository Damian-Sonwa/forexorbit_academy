export const RATE_LIMIT_COLLECTION: string;
export const RATE_LIMIT_TTL_INDEX: {
  id: string;
  collection: string;
  key: Record<string, 1>;
  options: { name: string; expireAfterSeconds: number };
};
export function consumeSharedLimit(
  db: unknown,
  input: { scope: string; key: string; windowMs: number; max: number; now?: number }
): Promise<{ allowed: boolean; retryAfterSec: number }>;
export function sharedLimitEnabled(env?: Record<string, string | undefined>): boolean;
