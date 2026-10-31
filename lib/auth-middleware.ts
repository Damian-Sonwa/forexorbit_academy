/**
 * Authentication Middleware
 * Protects API routes with the HttpOnly session cookie (lib/session-core.js) and the current user
 * record. State-changing requests must also pass the Origin and CSRF-header check.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSocketServer } from './socket-server';
import { Server } from 'socket.io';
import { getDb } from './mongodb';
import { decideAccountAccess, clientSafeAuthError } from './account-access';
import type { AppRole } from './account-access';
import { authenticateRequest, checkRequestOrigin } from './session-auth';

export interface AuthRequest extends NextApiRequest {
  user?: {
    userId: string;
    email: string;
    role: AppRole;
  };
  /** The session family (one sign-in and its rotations), for signing out this device. */
  sessionFamilyId?: string;
  io?: Server;
}

function preserveCors(res: NextApiResponse, existingCorsOrigin: string | number | string[] | undefined) {
  if (existingCorsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', existingCorsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

/**
 * Middleware to verify the session cookie and the live account role.
 * Roles come from the account record on every request, never from the client.
 */
export function withAuth(
  handler: (req: AuthRequest, res: NextApiResponse) => Promise<void>,
  allowedRoles?: AppRole[]
) {
  return async (req: AuthRequest, res: NextApiResponse) => {
    const existingCorsOrigin = res.getHeader('Access-Control-Allow-Origin');

    try {
      const origin = checkRequestOrigin(req);
      if (!origin.ok) {
        preserveCors(res, existingCorsOrigin);
        res.status(origin.status).json({ error: origin.error, code: origin.code });
        return;
      }

      const db = await getDb();
      const session = await authenticateRequest(req, res, db);
      if (!session.ok) {
        preserveCors(res, existingCorsOrigin);
        res.status(session.status).json({ error: session.error });
        return;
      }

      // The session already checked that the account is active; roles are checked here.
      const decision = decideAccountAccess({
        userId: session.user.userId,
        record: { email: session.user.email, role: session.user.role, status: session.user.status },
        allowedRoles,
      });
      if (!decision.ok) {
        preserveCors(res, existingCorsOrigin);
        res.status(decision.status).json({ error: decision.error });
        return;
      }

      req.user = {
        userId: decision.user.userId,
        email: decision.user.email,
        role: decision.user.role,
      };
      req.sessionFamilyId = session.familyId;
      const io = getSocketServer();
      if (io) {
        req.io = io;
      }
      return handler(req, res);
    } catch (error: unknown) {
      const safe = clientSafeAuthError(error instanceof Error ? error : null);
      preserveCors(res, existingCorsOrigin);
      if (safe.status === 500) {
        console.error('Auth middleware error');
      }
      res.status(safe.status).json({ error: safe.error });
    }
  };
}
