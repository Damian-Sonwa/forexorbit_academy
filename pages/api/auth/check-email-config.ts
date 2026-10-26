/**
 * Diagnostic: SMS provider configured for password reset (OTP)
 * GET /api/auth/check-email-config  (path kept for existing bookmarks)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSmsProvider, isSmsConfigured } from '@/lib/sms';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const provider = getSmsProvider();
    const configured = isSmsConfigured();

    res.json({
      configured,
      provider,
      passwordResetChannel: 'sms_otp',
      environment: process.env.NODE_ENV,
      checks:
        provider === 'twilio'
          ? {
              twilioAccountSid: !!process.env.TWILIO_ACCOUNT_SID?.trim(),
              twilioAuthToken: !!process.env.TWILIO_AUTH_TOKEN?.trim(),
              twilioPhoneNumber: !!process.env.TWILIO_PHONE_NUMBER?.trim(),
            }
          : {
              termiiApiKey: !!process.env.TERMII_API_KEY?.trim(),
              termiiSenderId: process.env.TERMII_SENDER_ID || 'ForexOrbit (default)',
            },
      message: configured
        ? `SMS (${provider}) is configured for password reset OTP`
        : `Set ${provider === 'twilio' ? 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER' : 'TERMII_API_KEY'} (or SMS_PROVIDER=termii|twilio).`,
      smsDefaultRegion: process.env.SMS_DEFAULT_REGION || 'NG',
    });
  } catch (error: unknown) {
    console.error('Check SMS config error:', error);
    res.status(500).json({ error: 'Failed to check SMS configuration' });
  }
}
