/**
 * Send a test SMS (password-reset style) — protect in production if needed
 * POST /api/auth/test-email  { phone }  (path kept for tooling)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { parseToE164 } from '@/lib/phone';
import { sendPasswordResetOtpSms, isSmsConfigured } from '@/lib/sms';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    if (!isSmsConfigured()) {
      return res.status(400).json({
        error: 'SMS not configured',
        message: 'Set Twilio or Termii environment variables (see check-email-config / .env.example).',
      });
    }

    const parsed = parseToE164(phone);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    const testOtp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    await sendPasswordResetOtpSms(parsed.e164, testOtp);

    return res.status(200).json({
      success: true,
      message: 'Test SMS sent (contains a random 6-digit code, not a real reset).',
      phone: parsed.e164,
    });
  } catch (error: unknown) {
    console.error('Test SMS error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to send';
    return res.status(500).json({ error: 'Failed to send test SMS', message: msg });
  }
}
