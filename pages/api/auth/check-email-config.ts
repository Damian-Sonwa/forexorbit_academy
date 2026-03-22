/**
 * Check Email Configuration API Route
 * Diagnostic: Resend API key present for password reset emails
 * GET /api/auth/check-email-config
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isEmailConfigured } from '@/lib/email';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const configured = isEmailConfigured();
    const hasApiKey = !!process.env.RESEND_API_KEY?.trim();
    const fromSet = !!process.env.RESEND_FROM?.trim();

    res.json({
      configured,
      provider: 'resend',
      environment: process.env.NODE_ENV,
      checks: {
        resendApiKey: hasApiKey,
        resendFromOverride: fromSet,
      },
      message: configured
        ? 'Email (Resend) is configured for password reset'
        : 'Set RESEND_API_KEY in environment variables (Vercel / .env.local).',
      apiKeyLength: process.env.RESEND_API_KEY?.length || 0,
      resendFrom: process.env.RESEND_FROM || 'onboarding@resend.dev (default)',
    });
  } catch (error: unknown) {
    console.error('Check email config error:', error);
    res.status(500).json({ error: 'Failed to check email configuration' });
  }
}
