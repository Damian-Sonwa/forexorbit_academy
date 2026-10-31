/**
 * CORS for credentialed API requests (Phase 4.5): only the exact trusted origins from
 * lib/request-guard.js (APP_ORIGIN, plus the local dev server outside production). There are no
 * platform wildcards: with cookie sessions, any echoed origin could make authenticated requests.
 * Pages, API and sockets share one canonical origin, so most requests need no CORS at all.
 */

import type { NextRequest } from 'next/server';
import { corsOrigin } from './request-guard';

/** Returns the Origin value to echo in Access-Control-Allow-Origin, or null if not allowed. */
export function getAllowedCorsOrigin(request: NextRequest): string | null {
  return corsOrigin(request.headers.get('origin'));
}
