/**
 * Shared guard rails for course payment API routes.
 */

import crypto from 'crypto';
import type { NextApiResponse } from 'next';
import type { AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { isStaffRole } from '@/lib/lesson-monetization';
import { createRateLimiter } from '@/lib/rate-limit';
import {
  confirmCoursePayment,
  decidePaymentEnvironment,
  fetchPaystackTransaction,
  presentConfirmResult,
  type ProviderLookup,
} from '@/lib/course-payment';

const initLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10 });
const confirmLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });

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

export function withinRateLimit(kind: 'init' | 'confirm', req: AuthRequest, res: NextApiResponse): boolean {
  const limiter = kind === 'init' ? initLimiter : confirmLimiter;
  const decision = limiter.check(`${kind}:${req.user!.userId}`);
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
  if (!paymentsAllowed(res) || !studentOnly(req, res) || !withinRateLimit('confirm', req, res)) return;
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
