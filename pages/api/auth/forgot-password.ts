/**
 * Forgot Password — email a reset link
 * POST /api/auth/forgot-password  { email }
 *
 * Every valid address gets the same 200 response; a link is emailed only to an active account
 * (lib/password-reset.js). 400 for a malformed address, 429/503 from the rate limits.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { unexpectedBody } from '@/lib/public-error';
import { clientAddress } from '@/lib/client-ip';
import { passwordResetService, sendResetResult } from '@/lib/password-reset-route';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const result = await passwordResetService.requestReset({ body: req.body, ip: clientAddress(req) });
    return sendResetResult(res, result);
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('forgot-password', error));
  }
}
