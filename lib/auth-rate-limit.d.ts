import type { NextApiResponse } from 'next';
import type { Db } from 'mongodb';

export type AuthRule = { id: string; max: number; parts: readonly ('ip' | 'email' | 'phone' | 'ticket')[] };
export type AuthLimitDecision =
  | { allowed: true }
  | { allowed: false; status: 429; retryAfterSec: number }
  | { allowed: false; status: 503 };

export const WINDOW_MS: number;
export const MAX_LOCAL_KEYS: number;
export const LOGIN_RULES: readonly AuthRule[];
export const SIGNUP_RULES: readonly AuthRule[];
export const RESET_REQUEST_RULES: readonly AuthRule[];
export const RESET_COOLDOWN_RULES: readonly AuthRule[];
export const RESET_COOLDOWN_WINDOW_MS: number;
export const RESET_VERIFY_RULES: readonly AuthRule[];
export const RESET_COMPLETE_RULES: readonly AuthRule[];
export function normalizeEmail(value: unknown): string;
export function keyFor(rule: AuthRule, values: Record<string, string>, secret: string): string;
export function createAuthLimiter(
  rules: readonly AuthRule[],
  options?: { windowMs?: number }
): {
  consume(input: {
    ip: string | null;
    email?: unknown;
    phone?: string | null;
    ticket?: string | null;
    getDb: () => Promise<Db>;
    env?: Record<string, string | undefined>;
    now?: number;
  }): Promise<AuthLimitDecision>;
};
export function sendRefusal(res: NextApiResponse, decision: Exclude<AuthLimitDecision, { allowed: true }>): void;
