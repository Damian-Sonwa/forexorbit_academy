/**
 * Guard rails shared by the Super Admin purchase ledger API routes.
 * Every route is also wrapped in `withAuth(handler, ['superadmin'])`; this check repeats the role
 * decision so a mistaken wrapper cannot expose payment data.
 */

import type { NextApiResponse } from 'next';
import type { AuthRequest } from '@/lib/auth-middleware';
import { authorizeLedgerAccess } from '@/lib/admin-purchase-ledger';
import { getDb } from '@/lib/mongodb';
import { createRateLimiter } from '@/lib/rate-limit';
import { consumeSharedLimit, sharedLimitEnabled } from '@/lib/shared-rate-limit';

const LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LIMITS = { provider: 20, write: 60 } as const;
const providerLimiter = createRateLimiter({ windowMs: LIMIT_WINDOW_MS, max: LIMITS.provider });
const writeLimiter = createRateLimiter({ windowMs: LIMIT_WINDOW_MS, max: LIMITS.write });

export function superAdminOnly(req: AuthRequest, res: NextApiResponse): boolean {
  res.setHeader('Cache-Control', 'no-store');
  if (authorizeLedgerAccess(req.user)) return true;
  res.status(403).json({ error: 'Only a super admin can view payment records.' });
  return false;
}

/** Counted in this process and in the shared store; refused if the shared store is unreachable. */
export async function withinLedgerLimit(kind: 'provider' | 'write', req: AuthRequest, res: NextApiResponse): Promise<boolean> {
  const userId = req.user!.userId;
  let decision = (kind === 'provider' ? providerLimiter : writeLimiter).check(`${kind}:${userId}`);
  if (decision.allowed && sharedLimitEnabled()) {
    try {
      decision = await consumeSharedLimit(await getDb(), { scope: `ledger-${kind}`, key: userId, windowMs: LIMIT_WINDOW_MS, max: LIMITS[kind] });
    } catch {
      res.status(503).json({ error: 'The ledger is briefly unavailable. Try again shortly.' });
      return false;
    }
  }
  if (decision.allowed) return true;
  res.setHeader('Retry-After', String(decision.retryAfterSec));
  res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
  return false;
}

export function firstQueryValues(query: AuthRequest['query']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') out[key] = first;
  }
  return out;
}
