/**
 * Shared guard rails for course payment API routes.
 */

import crypto from 'crypto';
import type { NextApiResponse } from 'next';
import type { AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { isStaffRole } from '@/lib/lesson-monetization';
import { createRateLimiter } from '@/lib/rate-limit';
import { consumeSharedLimit } from '@/lib/shared-rate-limit';
import {
  confirmCoursePayment,
  decidePaymentEnvironment,
  fetchPaystackTransaction,
  presentConfirmResult,
  type ProviderLookup,
} from '@/lib/course-payment';

const LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LIMITS = { init: 10, confirm: 30 } as const;
const initLimiter = createRateLimiter({ windowMs: LIMIT_WINDOW_MS, max: LIMITS.init });
const confirmLimiter = createRateLimiter({ windowMs: LIMIT_WINDOW_MS, max: LIMITS.confirm });

export function newSupportId(): string {
  return crypto.randomUUID();
}

/** Logs references and outcome codes only. Never pass emails, provider bodies, or secrets. */
export function logPayment(tag: string, fields: Record<string, string | number | boolean | null | undefined>): void {
  console.log(`[payments] ${tag}`, fields);
}

export function lookupPaystackTransaction(reference: string): Promise<ProviderLookup> {
  return fetchPaystackTransaction(reference, { secret: process.env.PAYSTACK_SECRET_KEY });
}

/** Sends the denial and returns false when payments must not run in this environment. */
export function paymentsAllowed(res: NextApiResponse): boolean {
  const environment = decidePaymentEnvironment(process.env);
  if (environment.enabled) return true;
  logPayment('environment-blocked', { reason: environment.reason });
  res.status(environment.status).json({ success: false, code: environment.reason, message: environment.message });
  return false;
}

export function studentOnly(req: AuthRequest, res: NextApiResponse): boolean {
  if (!isStaffRole(req.user!.role)) return true;
  res.status(400).json({ success: false, code: 'staff_account', message: 'Staff accounts do not purchase courses' });
  return false;
}

/**
 * Per-user limit, counted in this process and in the shared store so several server instances
 * cannot multiply it. If the shared store is unreachable the request is refused, not let through.
 */
export async function withinRateLimit(kind: 'init' | 'confirm', req: AuthRequest, res: NextApiResponse): Promise<boolean> {
  const limiter = kind === 'init' ? initLimiter : confirmLimiter;
  const userId = req.user!.userId;
  let decision = limiter.check(`${kind}:${userId}`);
  if (decision.allowed) {
    try {
      decision = await consumeSharedLimit(await getDb(), { scope: `payment-${kind}`, key: userId, windowMs: LIMIT_WINDOW_MS, max: LIMITS[kind] });
    } catch {
      logPayment('rate-limit-unavailable', { kind });
      res.status(503).json({ success: false, code: 'rate_limit_unavailable', retryable: true, message: 'Payments are briefly unavailable. Try again shortly.' });
      return false;
    }
  }
  if (decision.allowed) return true;
  res.setHeader('Retry-After', String(decision.retryAfterSec));
  res.status(429).json({ success: false, code: 'rate_limited', retryable: true, message: 'Too many payment requests. Wait a moment and try again.' });
  return false;
}

/** Common confirm handler for every student-facing confirmation route. */
export async function respondWithCourseConfirmation(
  req: AuthRequest,
  res: NextApiResponse,
  params: { tag: string; reference: unknown; expectedCourseId?: unknown }
) {
  if (!paymentsAllowed(res) || !studentOnly(req, res) || !(await withinRateLimit('confirm', req, res))) return;
  const supportId = newSupportId();
  const reference = typeof params.reference === 'string' ? params.reference.trim() : '';
  const expectedCourseId =
    typeof params.expectedCourseId === 'string' && params.expectedCourseId.trim() ? params.expectedCourseId.trim() : undefined;
  try {
    const db = await getDb();
    const result = await confirmCoursePayment(db, {
      reference,
      source: 'checkout',
      sessionUserId: req.user!.userId,
      expectedCourseId,
      fetchTransaction: lookupPaystackTransaction,
    });
    logPayment(params.tag, {
      supportId,
      reference: reference.slice(0, 100),
      code: result.ok ? (result.alreadyProcessed ? 'already_processed' : 'granted') : result.code,
    });
    const { status, body } = presentConfirmResult(result, supportId);
    return res.status(status).json(body);
  } catch {
    logPayment(params.tag, { supportId, reference: reference.slice(0, 100), code: 'internal_error' });
    return res.status(503).json({
      success: false,
      code: 'internal_error',
      retryable: true,
      message: 'We could not finish confirming this payment. Try again shortly.',
      supportId,
    });
  }
}
