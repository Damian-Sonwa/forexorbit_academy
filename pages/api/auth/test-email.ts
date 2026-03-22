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
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    if (!isSmsConfigured()) {
      return res.status(400).json({
        message:
          'SMS not configured. Set Twilio or Termii environment variables (see check-email-config / .env.example).',
      });
    }

    const parsed = parseToE164(phone);
    if (!parsed) {
      return res.status(400).json({ message: 'Invalid phone number' });
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
    return res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}
