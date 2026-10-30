import type { Db } from 'mongodb';
import type { AuthLimitDecision } from './auth-rate-limit';

type Env = Record<string, string | undefined>;
type EmailResult = { ok: true } | { ok: false; reason: string };

export type PasswordResetMailer = {
  passwordResetEmailReady(env?: Env): { ok: true } | { ok: false; reason: string };
  sendPasswordResetEmail(
    input: { to: string; name?: unknown; token: string; expiresAt: Date; idempotencyKey: string },
    options?: { env?: Env }
  ): Promise<EmailResult>;
  sendPasswordChangedEmail(input: { to: string; name?: unknown; idempotencyKey: string }, options?: { env?: Env }): Promise<EmailResult>;
};

export type PasswordResetResult =
  | { status: number; body: Record<string, unknown>; refusal?: undefined }
  | { refusal: Exclude<AuthLimitDecision, { allowed: true }> };

export const INVALID_EMAIL: string;
export const MIN_RESPONSE_MS: number;
export const RESET_COMPLETE: string;
export const RESET_REQUESTED: string;
export const SECURITY_LOG_COLLECTION: string;
export function isValidEmail(email: string): boolean;
export function createPasswordResetService(deps: {
  getDb: () => Promise<Db>;
  mailer: PasswordResetMailer;
  env?: Env;
  minResponseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  hashPassword?: (password: string) => Promise<string>;
}): {
  requestReset(input: { body: unknown; ip: string | null }): Promise<PasswordResetResult>;
  completeReset(input: { body: unknown; ip: string | null }): Promise<PasswordResetResult>;
};
