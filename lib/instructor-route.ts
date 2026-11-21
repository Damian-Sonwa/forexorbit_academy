/**
 * Shared handling for the Phase 12 instructor portal reads: session and live account (withAuth;
 * instructors, admins, Super Admin; suspended or pending accounts are refused there), GET only,
 * private no-store responses, per-account rate limit, refusal mapping and safe errors. The member
 * is always the session's account; scope checks are in lib/instructor-portal.js.
 */

import type { NextApiResponse } from 'next';
import type { Db } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { allowRequest, instructorReadLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

export type Member = { userId: string; role: string };
type Result = { ok: boolean; status?: number; error?: string } & Record<string, unknown>;
type Handler = (req: AuthRequest, db: Db, member: Member) => Promise<Result>;

export function instructorRoute(event: string, handler: Handler) {
  return withAuth(async (req: AuthRequest, res: NextApiResponse): Promise<void> => {
    setPrivateNoStore(res);
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const member = { userId: req.user!.userId, role: req.user!.role };
      if (!(await allowRequest(instructorReadLimiter, { userId: member.userId, res, getDb }))) return;
      const { ok, status, error, ...body } = await handler(req, await getDb(), member);
      if (!ok) {
        res.status(status || 403).json({ error: error || 'Not authorized' });
        return;
      }
      res.json(body);
    } catch (err: unknown) {
      console.error(JSON.stringify({ event, result: 'failed' }));
      res.status(500).json(unexpectedBody('api', err));
    }
  }, ['instructor', 'admin', 'superadmin']);
}

export const queryText = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');
export const wholeNumber = (value: string | string[] | undefined) => {
  const text = queryText(value);
  return /^[1-9]\d{0,4}$/.test(text) ? Number(text) : undefined;
};
