/**
 * JWT Utility Functions
 * Handles token generation and verification
 */

import {
  generateToken as signToken,
  verifyToken as checkToken,
  extractToken as readToken,
  sessionBinding as bindSession,
  decideSessionBinding as checkSessionBinding,
  issueAuthToken as signAuthToken,
} from './token-core';
import type { TokenPayload } from './token-core';

export type { TokenPayload };
export const sessionBinding = bindSession;
export const decideSessionBinding = checkSessionBinding;
export const issueAuthToken = signAuthToken;

/**
 * Generate JWT token
 */
export function generateToken(payload: TokenPayload): string {
  return signToken(payload);
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): TokenPayload {
  return checkToken(token);
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | null): string | null {
  return readToken(authHeader);
}
