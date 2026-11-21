/**
 * Which background composition a route uses (styles/globals.css, body[data-surface]).
 * Purely visual: it never affects access or data.
 */
export type DesignSurface = 'public' | 'auth' | 'learn' | 'practice' | 'admin';

const AUTH = ['/login', '/signup', '/forgot-password', '/reset-password', '/onboarding'];
const PRACTICE = ['/demo-trading', '/student-dashboard'];
const ADMIN = ['/admin', '/instructor', '/consultations/admin'];
const PUBLIC = ['/', '/about', '/how-it-works', '/pricing', '/privacy', '/terms', '/legal'];

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function surfaceFor(pathname: string): DesignSurface {
  if (AUTH.some((p) => matches(pathname, p))) return 'auth';
  if (PRACTICE.some((p) => matches(pathname, p))) return 'practice';
  if (ADMIN.some((p) => matches(pathname, p))) return 'admin';
  if (pathname === '/' || PUBLIC.slice(1).some((p) => matches(pathname, p))) return 'public';
  return 'learn';
}
