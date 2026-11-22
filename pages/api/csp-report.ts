/**
 * POST: Content-Security-Policy violation reports (Phase 15, report-only rollout; next.config.js).
 * Public by necessity (browsers send these without credentials). The body is capped at 8 KB and
 * each address may send at most 30 reports a minute; beyond that reports are dropped. Only the
 * directive, the blocked host (no path or query) and the page path (no query) are logged, so no
 * tokens or personal data reach the logs. Always answers 204.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { clientAddress } from '@/lib/client-ip';

export const config = { api: { bodyParser: false } };
const MAX_BYTES = 8 * 1024;
const PER_MINUTE = 30;
const seen = new Map<string, { count: number; resetAt: number }>();

function allowed(ip: string, now = Date.now()) {
  const entry = seen.get(ip);
  if (!entry || entry.resetAt < now) {
    if (seen.size > 5000) seen.clear();
    seen.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= PER_MINUTE;
}

const hostOf = (value: unknown) => {
  if (typeof value !== 'string') return null;
  if (!/^[a-z]+:/i.test(value)) return value.slice(0, 40); // 'inline', 'eval', 'data' ...
  try {
    return new URL(value).host || new URL(value).protocol;
  } catch {
    return null;
  }
};
const pathOf = (value: unknown) => {
  try {
    return typeof value === 'string' ? new URL(value).pathname.slice(0, 120) : null;
  } catch {
    return null;
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  try {
    if (!allowed(clientAddress(req) || 'unknown')) return res.status(204).end();
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_BYTES) return res.status(204).end();
      chunks.push(buf);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const report = body && typeof body === 'object' ? body['csp-report'] || body : {};
    console.warn(JSON.stringify({
      event: 'cspViolation',
      directive: typeof report['effective-directive'] === 'string' ? report['effective-directive'] : typeof report['violated-directive'] === 'string' ? report['violated-directive'].split(' ')[0] : null,
      blocked: hostOf(report['blocked-uri']),
      page: pathOf(report['document-uri']),
    }));
  } catch {
    // Malformed reports are ignored.
  }
  return res.status(204).end();
}
