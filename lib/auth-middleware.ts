/**
 * Authentication Middleware
 * Protects API routes with JWT verification
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { verifyToken, extractToken } from './jwt';
import { getSocketServer } from './socket-server';
import { Server } from 'socket.io';

export interface AuthRequest extends NextApiRequest {
  user?: {
    userId: string;
    email: string;
    role: 'superadmin' | 'admin' | 'instructor' | 'student';
  };
  io?: Server;
}

/**
 * Middleware to verify JWT token
 */
export function withAuth(
  handler: (req: AuthRequest, res: NextApiResponse) => Promise<void>,
  allowedRoles?: ('superadmin' | 'admin' | 'instructor' | 'student')[]
) {
  return async (req: AuthRequest, res: NextApiResponse) => {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization || req.headers.Authorization as string || null;
      const token = extractToken(authHeader);
      
      if (!token) {
        console.error('No token found in request headers');
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const payload = verifyToken(token);
      
      // Log for debugging
      console.log('Auth check - User:', payload.email, 'Role:', payload.role, 'Allowed roles:', allowedRoles);
      
      // Check role if specified
      if (allowedRoles && !allowedRoles.includes(payload.role)) {
        console.error('Role check failed - User role:', payload.role, 'Allowed:', allowedRoles);
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      req.user = payload;
      // Attach Socket.io instance if available
      const io = getSocketServer();
      if (io) {
        req.io = io;
      }
      return handler(req, res);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid token';
      console.error('Auth middleware error:', errorMessage);
      res.status(401).json({ error: errorMessage });
    }
  };
}

