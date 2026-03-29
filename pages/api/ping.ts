/**
 * GET /api/ping — no DB, no heavy imports. Use to verify Next.js responds at all.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false });
  }
  res.status(200).json({ ok: true, t: Date.now() });
}
