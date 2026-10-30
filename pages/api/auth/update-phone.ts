/**
 * Retired: setting a phone number for password reset. Password reset now uses the account's
 * email address, so this endpoint no longer changes anything. Kept as 410 Gone for older clients.
 * Stored phone numbers are left as they are.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({
    error: 'Phone numbers are no longer used for password reset. Reset links are sent to your account email.',
    code: 'phone_reset_retired',
  });
}
