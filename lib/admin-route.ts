/**
 * Shared handling for the Phase 13 admin portal reads: session and live account (withAuth; admins
 * and the Super Admin only; suspended or pending accounts are refused there), GET only, private
 * no-store responses, per-account rate limit, refusal mapping and safe errors. Super Admin-only
 * parts are decided in lib/admin-portal.js from the same live role.
 */

import type { NextApiResponse } from 'next';
import type { Db } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
type StaffRole = 'admin' | 'superadmin';
import { getDb } from '@/lib/mongodb';
import { adminReadLimiter, allowRequest } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

export type AdminMember = { userId: string; role: string; email?: string };
type Result = { ok: boolean; status?: number; error?: string } & Record<string, unknown>;
type Handler = (req: AuthRequest, db: Db, member: AdminMember) => Promise<Result> | Result;

export function adminRoute(event: string, handler: Handler, roles: StaffRole[] = ['admin', 'superadmin']) {
  return withAuth(async (req: AuthRequest, res: NextApiResponse): Promise<void> => {
    setPrivateNoStore(res);
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const member = { userId: req.user!.userId, role: req.user!.role, email: req.user!.email };
      if (!(await allowRequest(adminReadLimiter, { userId: member.userId, res, getDb }))) return;
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
  }, roles);
}

export const q = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');
export const n = (value: string | string[] | undefined) => {
  const text = q(value);
  return /^[1-9]\d{0,4}$/.test(text) ? Number(text) : undefined;
};
