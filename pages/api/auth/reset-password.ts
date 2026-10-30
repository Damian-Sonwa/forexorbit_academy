/**
 * Reset Password — set a new password with the emailed link
 * POST /api/auth/reset-password  { token, password }
 *
 * The link works once, for 30 minutes, for an active account (lib/password-reset.js). Success
 * raises sessionGeneration, which signs out every existing session. 400 with a code
 * (invalid_token, expired_token, used_token, superseded_token, weak_password), 429/503 from the
 * rate limits.
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
    const result = await passwordResetService.completeReset({ body: req.body, ip: clientAddress(req) });
    return sendResetResult(res, result);
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('reset-password', error));
  }
}
