/**
 * Authentication Middleware
 * Protects API routes with JWT verification
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { verifyToken, extractToken } from './jwt';

export interface AuthRequest extends NextApiRequest {
  user?: {
    userId: string;
    email: string;
    role: 'admin' | 'instructor' | 'student';
  };
}

/**
 * Middleware to verify JWT token
 */
export function withAuth(
  handler: (req: AuthRequest, res: NextApiResponse) => Promise<void>,
  allowedRoles?: ('admin' | 'instructor' | 'student')[]
) {
  return async (req: AuthRequest, res: NextApiResponse) => {
    try {
      const token = extractToken(req.headers.authorization || null);
      
      if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const payload = verifyToken(token);
      
      // Check role if specified
      if (allowedRoles && !allowedRoles.includes(payload.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      req.user = payload;
      return handler(req, res);
    } catch (error: any) {
      return res.status(401).json({ error: error.message || 'Invalid token' });
    }
  };
}

