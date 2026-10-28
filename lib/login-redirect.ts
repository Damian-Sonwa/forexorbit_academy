/** Internal paths only. Rejects absolute URLs, protocol-relative URLs, and auth pages. */
export function safeNextPath(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const path = raw.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  if (/^\/(login|signup)(\/|\?|$)/.test(path)) return null;
  return path;
}

export function loginHref(next?: string): string {
  const safe = safeNextPath(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
}

export function signupHref(next?: string): string {
  const safe = safeNextPath(next);
  return safe ? `/signup?next=${encodeURIComponent(safe)}` : '/signup';
}
