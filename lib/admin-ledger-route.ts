/**
 * Guard rails shared by the Super Admin purchase ledger API routes.
 * Every route is also wrapped in `withAuth(handler, ['superadmin'])`; this check repeats the role
 * decision so a mistaken wrapper cannot expose payment data.
 */

import type { NextApiResponse } from 'next';
import type { AuthRequest } from '@/lib/auth-middleware';
import { authorizeLedgerAccess } from '@/lib/admin-purchase-ledger';
import { createRateLimiter } from '@/lib/rate-limit';

const providerLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
const writeLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 60 });

export function superAdminOnly(req: AuthRequest, res: NextApiResponse): boolean {
  res.setHeader('Cache-Control', 'no-store');
  if (authorizeLedgerAccess(req.user)) return true;
  res.status(403).json({ error: 'Only a super admin can view payment records.' });
  return false;
}

export function withinLedgerLimit(kind: 'provider' | 'write', req: AuthRequest, res: NextApiResponse): boolean {
  const decision = (kind === 'provider' ? providerLimiter : writeLimiter).check(`${kind}:${req.user!.userId}`);
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
