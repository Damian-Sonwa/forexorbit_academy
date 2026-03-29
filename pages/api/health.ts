/**
 * GET /api/health
 * Lightweight diagnostics for deployment (no secrets exposed).
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  const mongoEnv = Boolean(process.env.MONGO_URI?.trim() || process.env.MONGODB_URI?.trim());
  const jwtEnv = Boolean(process.env.JWT_SECRET?.trim());
  let dbPing = false;
  let dbError: string | undefined;

  try {
    const { getDb } = await import('@/lib/mongodb');
    const db = await getDb();
    await db.command({ ping: 1 });
    dbPing = true;
  } catch (e: unknown) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const ok = mongoEnv && jwtEnv && dbPing;

  return res.status(ok ? 200 : 503).json({
    ok,
    checks: {
      mongoEnvConfigured: mongoEnv,
      jwtSecretConfigured: jwtEnv,
      databasePing: dbPing,
    },
    nodeEnv: process.env.NODE_ENV || 'development',
    ...(dbError && !dbPing ? { hint: 'Fix MONGO_URI / MONGODB_URI and IP allowlist (Atlas).' } : {}),
    ...(!jwtEnv ? { hint: 'Set JWT_SECRET on the host (Render env vars).' } : {}),
    timestamp: new Date().toISOString(),
  });
}
