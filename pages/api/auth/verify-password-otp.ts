/**
 * Retired: password reset by SMS code. Reset links are now sent by email
 * (POST /api/auth/forgot-password { email }). Kept as 410 Gone for older clients.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({
    error: 'Password reset by text message has been replaced. Use Forgot password to get a reset link by email.',
    code: 'phone_reset_retired',
  });
}
