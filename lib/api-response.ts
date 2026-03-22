/**
 * Consistent JSON error responses for API routes.
 * Always include { message: string } for the client; log details server-side only.
 */

import type { NextApiResponse } from 'next';

export const API_GENERIC_ERROR = 'Something went wrong. Please try again later.';

export function apiJson<T extends Record<string, unknown>>(
  res: NextApiResponse,
  status: number,
  body: T & { message?: string }
) {
  return res.status(status).json(body);
}

export function apiBadRequest(res: NextApiResponse, message: string, extra?: Record<string, unknown>) {
  return res.status(400).json({ message, ...extra });
}

export function apiUnauthorized(res: NextApiResponse, message = 'Invalid credentials') {
  return res.status(401).json({ message });
}

export function apiForbidden(res: NextApiResponse, message = 'You are not authorized to perform this action') {
  return res.status(403).json({ message });
}

export function apiNotFound(res: NextApiResponse, message = 'The requested resource was not found') {
  return res.status(404).json({ message });
}

export function apiConflict(res: NextApiResponse, message: string) {
  return res.status(409).json({ message });
}

export function apiMethodNotAllowed(res: NextApiResponse, message = 'Method not allowed') {
  return res.status(405).json({ message });
}

/** 500: log err, never expose stack or internal messages to the client. */
export function apiInternalError(res: NextApiResponse, err: unknown, context?: string): void {
  if (context) {
    console.error(`[api:${context}]`, err);
  } else {
    console.error('[api]', err);
  }
  res.status(500).json({ message: API_GENERIC_ERROR });
}
