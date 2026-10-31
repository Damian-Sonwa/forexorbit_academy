/**
 * fetch() for API calls that cannot use the axios client (streamed bodies, file downloads,
 * multipart uploads). The browser sends the HttpOnly session cookie by itself; this helper only
 * adds the CSRF header that state-changing API routes require (lib/request-guard.js). It never
 * reads or stores a credential.
 */

import { CSRF_HEADER, CSRF_VALUE } from '@/lib/request-guard';

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(CSRF_HEADER, CSRF_VALUE);
  return fetch(input, { ...init, headers, credentials: 'include' });
}

/** The CSRF header for XMLHttpRequest uploads (with xhr.withCredentials = true). */
export const CSRF_REQUEST_HEADER: readonly [string, string] = [CSRF_HEADER, CSRF_VALUE];
