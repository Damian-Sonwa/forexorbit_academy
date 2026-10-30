/**
 * Retired: reported whether SMS delivery for password reset was configured. The email reset page
 * does not need it, and the response would reveal configuration. Kept as 410 Gone.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({
    error: 'This endpoint has been retired.',
    code: 'phone_reset_retired',
  });
}
