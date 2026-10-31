import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isFeatureApiBlocked, isFeaturePathBlocked } from '@/lib/config/features';
import { getAllowedCorsOrigin } from '@/lib/cors-origin';
import { CSRF_HEADER, decideRequestOrigin } from '@/lib/request-guard';

const STATIC_EXT = /\.(ico|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|eot|txt|xml|json|map)$/i;

function applyApiCorsHeaders(
  request: NextRequest,
  response: NextResponse,
  pathname: string
): void {
  if (!pathname.startsWith('/api')) return;
  const corsOrigin = getAllowedCorsOrigin(request);
  if (!corsOrigin) return;
  response.headers.set('Access-Control-Allow-Origin', corsOrigin);
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Vary', 'Origin');
}

/**
 * Reduces stale HTML/API responses after a Vercel deploy (browser + CDN cache).
 * Immutable Next chunks under /_next/static stay long-cached via filename hashing.
 * CORS on /api/* echoes only the exact trusted origin (APP_ORIGIN; lib/request-guard.js).
 * Every state-changing /api request must come from that origin and carry the CSRF header.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api')) {
    const corsOrigin = getAllowedCorsOrigin(request);
    if (request.method === 'OPTIONS' && corsOrigin) {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': `Content-Type, ${CSRF_HEADER}`,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    const guard = decideRequestOrigin({
      method: request.method,
      pathname,
      header: (name: string) => request.headers.get(name),
    });
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error, code: guard.code }, { status: guard.status });
    }
  }

  if (
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.ico' ||
    pathname === '/favicon.svg' ||
    STATIC_EXT.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/') && isFeatureApiBlocked(pathname)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (isFeaturePathBlocked(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  applyApiCorsHeaders(request, res, pathname);
  res.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.headers.set('Vercel-CDN-Cache-Control', 'private, no-cache, no-store, must-revalidate');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
