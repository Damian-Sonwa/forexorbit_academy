/**
 * Cookie sessions for Next API routes (Phase 4.5): reading the session cookie, issuing and
 * clearing it, and ending sessions and their sockets. The rules live in lib/session-core.js and
 * lib/request-guard.js; this file only connects them to NextApiRequest / NextApiResponse.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { Db } from 'mongodb';
import {
  clearedSessionCookie,
  cookieMaxAgeSeconds,
  createSession,
  generationOf,
  hashToken,
  readSessionCookie,
  resolveSession,
  revokeFamily,
  revokeUserSessions,
  sessionCookie,
} from './session-core';
import { decideRequestOrigin } from './request-guard';
import { endSocketsForFamily, endSocketsForUser } from './session-sockets';
import type { AppRole } from './account-access';

export interface SessionUser {
  userId: string;
  email: string;
  role: AppRole;
  status?: string;
}

/** Adds a Set-Cookie header without dropping one already set on this response. */
export function appendSetCookie(res: NextApiResponse, cookie: string) {
  const existing = res.getHeader('Set-Cookie');
  const list = existing == null ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

export function clearSessionCookie(res: NextApiResponse) {
  appendSetCookie(res, clearedSessionCookie());
}

export function sessionTokenFrom(req: NextApiRequest): string | null {
  return readSessionCookie(req.headers.cookie);
}

/** Origin and CSRF header check for state-changing requests (also enforced in middleware.ts). */
export function checkRequestOrigin(req: NextApiRequest) {
  const pathname = String(req.url || '').split('?')[0];
  return decideRequestOrigin({
    method: req.method,
    pathname,
    header: (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    },
  });
}

/**
 * Resolves the request's session. On success the rotated cookie (if any) is already set on `res`.
 * On failure a stale cookie is cleared, and the refusal is returned for the caller to send.
 */
export async function authenticateRequest(req: NextApiRequest, res: NextApiResponse, db: Db) {
  const token = sessionTokenFrom(req);
  if (!token) {
    return { ok: false as const, status: 401, error: 'Authentication required', reason: 'missing' };
  }
  const result = await resolveSession(db, token);
  if (!result.ok) {
    clearSessionCookie(res);
    return result as { ok: false; status: number; error: string; reason: string };
  }
  if (result.token) {
    appendSetCookie(res, sessionCookie(result.token, cookieMaxAgeSeconds(result.session, result.session.createdAt)));
  }
  return {
    ok: true as const,
    user: result.user as SessionUser,
    sessionId: result.session._id as string,
    familyId: result.session.familyId as string,
  };
}

/** Signs the account in on this browser: a new session and its cookie. */
export async function startSession(
  res: NextApiResponse,
  db: Db,
  account: { userId: string; sessionGeneration?: unknown }
) {
  const { token, session } = await createSession(db, {
    userId: account.userId,
    generation: generationOf(account),
  });
  appendSetCookie(res, sessionCookie(token, cookieMaxAgeSeconds(session, session.createdAt)));
  return session;
}

/**
 * Ends the session this request carries (and its rotation chain), and its sockets. The cookie is
 * cleared unless the caller sets a new one in the same response (sign-in).
 */
export async function endCurrentSession(
  req: NextApiRequest,
  res: NextApiResponse,
  db: Db,
  reason: string,
  { clearCookie = true }: { clearCookie?: boolean } = {}
) {
  const token = sessionTokenFrom(req);
  if (clearCookie) clearSessionCookie(res);
  if (!token) return;
  const session = await db.collection('sessions').findOne({ _id: hashToken(token) } as Record<string, unknown>, { projection: { familyId: 1 } });
  if (!session) return;
  await revokeFamily(db, session.familyId, reason);
  endSocketsForFamily(null, session.familyId);
}

/** Ends every session of an account and disconnects its sockets on this server. */
export async function endAllSessions(db: Db, userId: string, reason: string) {
  await revokeUserSessions(db, userId, reason);
  endSocketsForUser(null, userId);
}
