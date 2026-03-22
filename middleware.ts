import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isFeaturePathBlocked } from '@/lib/config/features';

const STATIC_EXT = /\.(ico|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|eot|txt|xml|json|map)$/i;

/**
 * Reduces stale HTML/API responses after a Vercel deploy (browser + CDN cache).
 * Immutable Next chunks under /_next/static stay long-cached via filename hashing.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.ico' ||
    pathname === '/favicon.svg' ||
    STATIC_EXT.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (isFeaturePathBlocked(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.headers.set('Vercel-CDN-Cache-Control', 'private, no-cache, no-store, must-revalidate');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
