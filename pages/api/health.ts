/**
 * GET /api/health
 * Uses server/health.js checkMongo() (standalone MongoClient ping).
 */

import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkMongo } = require('../../server/health') as { checkMongo: () => Promise<boolean> };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  const databasePing = await checkMongo();
  const mongoEnvConfigured = Boolean(
    process.env.MONGO_URI?.trim() || process.env.MONGODB_URI?.trim()
  );
  const jwtSecretConfigured = Boolean(process.env.JWT_SECRET?.trim());

  let hint: string | null = null;
  if (!databasePing) {
    hint = 'Fix MONGO_URI / MONGODB_URI and IP allowlist (Atlas).';
  } else if (!jwtSecretConfigured) {
    hint = 'Set JWT_SECRET on the host (e.g. Render env vars).';
  }

  const healthy = databasePing && jwtSecretConfigured && mongoEnvConfigured;

  return res.status(healthy ? 200 : 503).json({
    ok: databasePing,
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
