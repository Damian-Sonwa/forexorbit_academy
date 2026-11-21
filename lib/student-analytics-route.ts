/**
 * Shared handling for the Phase 11 student analytics routes: session and live account check
 * (withAuth, students only), GET only, private no-store responses, per-account rate limit and safe
 * errors. The student is always the session's account: handlers receive its id and nothing in the
 * request can name another student.
 */

import type { NextApiResponse } from 'next';
import type { Db } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { allowRequest, dashboardLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

type Handler = (req: AuthRequest, res: NextApiResponse, db: Db, userId: string) => Promise<unknown>;

export function studentAnalyticsRoute(event: string, handler: Handler) {
  return withAuth(async (req: AuthRequest, res: NextApiResponse): Promise<void> => {
    setPrivateNoStore(res);
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const userId = req.user!.userId;
      if (!(await allowRequest(dashboardLimiter, { userId, res, getDb }))) return;
      await handler(req, res, await getDb(), userId);
    } catch (error: unknown) {
      console.error(JSON.stringify({ event, result: 'failed' }));
      res.status(500).json(unexpectedBody('api', error));
    }
  }, ['student']);
}

export const queryText = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');
export const wholeNumber = (value: string | string[] | undefined) => {
  const text = queryText(value);
  return /^[1-9]\d{0,3}$/.test(text) ? Number(text) : undefined;
};
