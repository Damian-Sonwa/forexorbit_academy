/**
 * Cross-origin API + Socket: allow Vercel (and env-listed) origins to call Render / Next API.
 * Used by middleware; keep in sync with server.js Socket.IO ALLOWED_ORIGINS.
 */

import type { NextRequest } from 'next/server';

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (raw) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [
    'https://forexorbit-academy.vercel.app',
    'https://forexorbit-academy11.vercel.app',
    'https://forexorbit-academy001.vercel.app',
    'https://forexorbit-academy.onrender.com',
  ];
}

function isVercelPreview(hostname: string): boolean {
  return hostname.endsWith('.vercel.app');
}

/** Returns the Origin value to echo in Access-Control-Allow-Origin, or null if not allowed. */
export function getAllowedCorsOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;

  const allowed = parseAllowedOrigins();
  if (allowed.includes(origin)) return origin;

  try {
    const { hostname } = new URL(origin);
    if (isVercelPreview(hostname)) return origin;
    if (hostname.endsWith('.onrender.com')) return origin;
  } catch {
    return null;
  }

  return null;
}
