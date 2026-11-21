/**
 * Shared handling for the practical task API (/api/practical-tasks/*): session and live account
 * (withAuth: suspended, pending or deleted accounts are refused there), allowed methods,
 * private no-store responses, per-account rate limits, refusal mapping, safe errors, and delivery
 * of the notifications a service call returns (dedupe keys; a failed notification never fails the
 * request). The member is always the session's account; every permission check is in
 * lib/practical-tasks.js.
 */

import type { NextApiResponse } from 'next';
import type { Db } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { allowRequest, assessmentLimiter, authoringLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';
import { createNotificationsForUsers } from '@/lib/notifications';
import type { NotificationType } from '@/pages/api/notifications';

export type Member = { userId: string; role: string; email: string | null };
type Notice = { userIds: string[]; type: NotificationType; title: string; message: string; roleTarget: 'student' | 'instructor'; taskId?: string; relatedId?: string; dedupeKey: string; metadata?: Record<string, unknown> };
type Result = { ok: boolean; status?: number; error?: string; notify?: Notice | Notice[] | null } & Record<string, unknown>;
export type PracticalHandler = (req: AuthRequest, db: Db, member: Member) => Promise<Result>;
type Limiter = typeof assessmentLimiter;
type Method = { handler: PracticalHandler; limiter?: Limiter };
const ROLES = ['student', 'instructor', 'admin', 'superadmin'] as const;

async function deliver(notify: Result['notify']) {
  const list = Array.isArray(notify) ? notify : notify ? [notify] : [];
  for (const n of list) {
    if (!n.userIds.length) continue;
    try {
      const { userIds, ...params } = n;
      await createNotificationsForUsers(userIds, params);
    } catch {
      console.error(JSON.stringify({ event: 'practicalTaskNotify', type: n.type, result: 'failed' }));
    }
  }
}

export function practicalRoute(event: string, methods: Record<string, Method>) {
  return withAuth(async (req: AuthRequest, res: NextApiResponse): Promise<void> => {
    setPrivateNoStore(res);
    const method = methods[req.method || ''];
    if (!method) {
      res.setHeader('Allow', Object.keys(methods).join(', '));
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const member: Member = { userId: req.user!.userId, role: req.user!.role, email: req.user!.email || null };
      const limiter = method.limiter || (req.method === 'GET' ? assessmentLimiter : authoringLimiter);
      if (!(await allowRequest(limiter, { userId: member.userId, res, getDb }))) return;
      const { ok, status, error, notify, ...body } = await method.handler(req, await getDb(), member);
      if (!ok) {
        res.status(status || 403).json({ error: error || 'Not authorized', ...body });
        return;
      }
      await deliver(notify);
      res.status(status || 200).json(body);
    } catch (err: unknown) {
      console.error(JSON.stringify({ event, result: 'failed' }));
      res.status(500).json(unexpectedBody('api', err));
    }
  }, [...ROLES]);
}

export const queryText = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');
export const wholeNumber = (value: string | string[] | undefined) => {
  const text = queryText(value);
  return /^[1-9]\d{0,4}$/.test(text) ? Number(text) : undefined;
};
export const bodyOf = (req: AuthRequest): Record<string, unknown> => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
