/**
 * Shared handling for the Phase 14 communication API: session and live account (withAuth refuses
 * suspended, pending and signed-out callers), allowed methods per route, private no-store
 * responses, a per-account rate limit, refusal mapping, safe errors, and delivery of any
 * notification a service returns (one delivery path: lib/communication/deliver.js). The member is
 * always the session's account; permission rules live in the lib/communication modules.
 */

import type { NextApiResponse } from 'next';
import type { Db } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { allowRequest, activityLimiter, authoringLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';
import { deliverToRecipients } from '@/lib/communication/deliver';

export type Member = { userId: string; role: string; email: string | null; sessionFamilyId: string | null };
type Notice = { userIds: string[] } & Record<string, unknown>;
type Result = { ok: boolean; status?: number; error?: string; notify?: Notice | null } & Record<string, unknown>;
type Handler = (req: AuthRequest, db: Db, member: Member) => Promise<Result>;
type Limiter = typeof activityLimiter;

export function communicationRoute(event: string, methods: Record<string, { handler: Handler; limiter?: Limiter }>, roles: Array<'student' | 'instructor' | 'admin' | 'superadmin'> = ['student', 'instructor', 'admin', 'superadmin']) {
  return withAuth(async (req: AuthRequest, res: NextApiResponse): Promise<void> => {
    setPrivateNoStore(res);
    const method = methods[req.method || ''];
    if (!method) {
      res.setHeader('Allow', Object.keys(methods).join(', '));
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const member: Member = { userId: req.user!.userId, role: req.user!.role, email: req.user!.email || null, sessionFamilyId: req.sessionFamilyId || null };
      const limiter = method.limiter || (req.method === 'GET' ? activityLimiter : authoringLimiter);
      if (!(await allowRequest(limiter, { userId: member.userId, res, getDb }))) return;
      const db = await getDb();
      const { ok, status, error, notify, ...body } = await method.handler(req, db, member);
      if (!ok) {
        res.status(status || 403).json({ error: error || 'Not authorized', ...body });
        return;
      }
      if (notify && notify.userIds.length) {
        try {
          const { userIds, ...params } = notify;
          await deliverToRecipients(db, params, userIds);
        } catch {
          console.error(JSON.stringify({ event: `${event}Notify`, result: 'failed' }));
        }
      }
      res.status(status || 200).json(body);
    } catch (err: unknown) {
      console.error(JSON.stringify({ event, result: 'failed' }));
      res.status(500).json(unexpectedBody('api', err));
    }
  }, roles);
}

export const queryText = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');
export const bodyOf = (req: AuthRequest): Record<string, unknown> => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
