/**
 * Diagnostic: SMS provider configured for password reset (OTP)
 * GET /api/auth/check-email-config  (path kept for existing bookmarks)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isSmsConfigured } from '@/lib/sms';
import { unexpectedBody } from '@/lib/public-error';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    res.json({ configured: isSmsConfigured() });
  } catch (error: unknown) {
    res.status(500).json({ ...unexpectedBody('sms-config', error), configured: false });
  }
}
