/**
 * GET /api/health
 *
 * Default: **instant** — only env flags (no Mongo call). Safe for probes / curl.
 * Deep:   GET /api/health?deep=1 — runs Mongo ping with driver timeouts + 10s hard deadline.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { checkMongoWithDeadline } from '@/lib/check-mongo';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  const mongoEnvConfigured = Boolean(
    process.env.MONGO_URI?.trim() || process.env.MONGODB_URI?.trim()
  );
  const jwtSecretConfigured = Boolean(process.env.JWT_SECRET?.trim());

  const deep =
    req.query.deep === '1' ||
    req.query.deep === 'true' ||
    req.query.ping === '1';

  if (!deep) {
    const envOk = mongoEnvConfigured && jwtSecretConfigured;
    return res.status(envOk ? 200 : 503).json({
      ok: envOk,
      mode: 'live',
      checks: {
        mongoEnvConfigured,
        jwtSecretConfigured,
        databasePing: null,
      },
      nodeEnv: process.env.NODE_ENV || 'development',
      hint: envOk
        ? 'Server is up. Add ?deep=1 to test MongoDB (capped ~10s).'
        : 'Set MONGO_URI/MONGODB_URI and JWT_SECRET in .env.local',
      timestamp: new Date().toISOString(),
    });
  }

  const databasePing = await checkMongoWithDeadline(10_000);

  let hint: string | null = null;
  if (!databasePing) {
    hint = 'Mongo ping failed or timed out — check URI, Atlas IP allowlist, and network.';
  } else if (!jwtSecretConfigured) {
    hint = 'Set JWT_SECRET on the host (e.g. Render env vars).';
  }

  const healthy = databasePing && jwtSecretConfigured && mongoEnvConfigured;

  return res.status(healthy ? 200 : 503).json({
    ok: healthy,
    mode: 'deep',
    checks: {
      mongoEnvConfigured,
      jwtSecretConfigured,
      databasePing,
    },
    nodeEnv: process.env.NODE_ENV || 'development',
    hint,
    timestamp: new Date().toISOString(),
  });
}
