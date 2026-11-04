/**
 * Shared handling for the practice simulator's routes (Phase 10): one place for the session, the
 * student role, the method, private caching, rate limiting and safe errors. withAuth adds the
 * Origin and CSRF checks on every write.
 */

import type { NextApiResponse } from 'next';
import type { Db } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { allowRequest, tradingLimiter, tradingReadLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

type Handler = (req: AuthRequest, res: NextApiResponse, db: Db) => Promise<unknown>;

export function studentTradingRoute(methods: Record<string, Handler>) {
  return withAuth(async (req: AuthRequest, res: NextApiResponse): Promise<void> => {
    setPrivateNoStore(res);
    const handler = methods[req.method || ''];
    if (!handler) {
      res.setHeader('Allow', Object.keys(methods).join(', '));
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      if (!(await allowRequest(req.method === 'GET' ? tradingReadLimiter : tradingLimiter, { userId: req.user!.userId, res, getDb }))) return;
      await handler(req, res, await getDb());
    } catch (error: unknown) {
      console.error(JSON.stringify({ event: 'practiceTrading', result: 'failed' }));
      res.status(500).json(unexpectedBody('api', error));
    }
  }, ['student']);
}

export const queryText = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');
export const wholeNumber = (value: string | string[] | undefined) => {
  const text = queryText(value);
  return /^[1-9]\d{0,6}$/.test(text) ? Number(text) : undefined;
};
type Refusal = { status?: number; code?: string; error?: string; nextResetAt?: string };
export const refused = (res: NextApiResponse, result: object) => {
  const r = result as Refusal;
  return res.status(r.status || 500).json({ error: r.error, code: r.code, ...(r.nextResetAt ? { nextResetAt: r.nextResetAt } : {}) });
};
