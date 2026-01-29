/**
 * Check Email Configuration API Route
 * Diagnostic endpoint to check if email is properly configured
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
    const hasHost = !!process.env.SMTP_HOST;
    const hasPort = !!process.env.SMTP_PORT;
    const hasUser = !!process.env.SMTP_USER;
    const hasPassword = !!process.env.SMTP_PASSWORD;

    res.json({
      configured,
      environment: process.env.NODE_ENV,
      checks: {
        host: hasHost,
        port: hasPort,
        user: hasUser,
        password: hasPassword,
      },
      message: configured
        ? 'Email is properly configured'
        : 'Email configuration is missing. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASSWORD in your Vercel environment variables.',
      // Add lengths for debugging (don't expose actual values)
      hostLength: process.env.SMTP_HOST?.length || 0,
      portValue: process.env.SMTP_PORT || 'not set',
      userLength: process.env.SMTP_USER?.length || 0,
      passwordLength: process.env.SMTP_PASSWORD?.length || 0,
    });
  } catch (error: unknown) {
    console.error('Check email config error:', error);
    res.status(500).json({ error: 'Failed to check email configuration' });
  }
}

