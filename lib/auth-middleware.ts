/**
 * Authentication Middleware
 * Protects API routes with JWT verification and the current user record.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { verifyToken, extractToken, decideSessionBinding } from './jwt';
import { getSocketServer } from './socket-server';
import { Server } from 'socket.io';
import { ObjectId } from 'mongodb';
import { getDb } from './mongodb';
import { decideAccountAccess, clientSafeAuthError } from './account-access';
import type { AppRole } from './account-access';

export interface AuthRequest extends NextApiRequest {
  user?: {
    userId: string;
    email: string;
    role: AppRole;
  };
  io?: Server;
}

function preserveCors(res: NextApiResponse, existingCorsOrigin: string | number | string[] | undefined) {
  if (existingCorsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', existingCorsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

/**
 * Middleware to verify JWT token and the live account role.
 * The role inside the token is not used for authorization.
 */
export function withAuth(
  handler: (req: AuthRequest, res: NextApiResponse) => Promise<void>,
  allowedRoles?: AppRole[]
) {
  return async (req: AuthRequest, res: NextApiResponse) => {
    const existingCorsOrigin = res.getHeader('Access-Control-Allow-Origin');

    try {
      const authHeader = req.headers.authorization || (req.headers.Authorization as string) || null;
      const token = extractToken(authHeader);

      if (!token) {
        preserveCors(res, existingCorsOrigin);
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const payload = verifyToken(token);
      if (!payload?.userId || !ObjectId.isValid(payload.userId)) {
        preserveCors(res, existingCorsOrigin);
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }

      const db = await getDb();
      const record = await db.collection('users').findOne(
        { _id: new ObjectId(payload.userId) },
        { projection: { email: 1, role: 1, status: 1, sessionGeneration: 1 } }
      );
      const decision = decideAccountAccess({
        userId: payload.userId,
        record,
        allowedRoles,
      });

      if (!decision.ok) {
        preserveCors(res, existingCorsOrigin);
        res.status(decision.status).json({ error: decision.error });
        return;
      }

      const session = decideSessionBinding({
        userId: decision.user.userId,
        binding: payload.sv,
        generation: record?.sessionGeneration,
        key: process.env.JWT_SECRET || '',
      });
      if (!session.ok) {
        preserveCors(res, existingCorsOrigin);
        res.status(session.status).json({ error: session.error });
        return;
      }

      req.user = {
        userId: decision.user.userId,
        email: decision.user.email,
        role: decision.user.role,
      };
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
