/**
 * Test Email API Route
 * Sends a test email to verify SMTP configuration
 * POST /api/auth/test-email
 * 
 * WARNING: This endpoint should be protected in production
 * For now, it's open for debugging purposes
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sendPasswordResetEmail, isEmailConfigured } from '@/lib/email';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if email is configured
    const configured = isEmailConfigured();
    
    if (!configured) {
      return res.status(400).json({ 
        error: 'Email not configured',
        message: 'Please set SMTP environment variables in Vercel',
        required: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'],
        current: {
          hasHost: !!process.env.SMTP_HOST,
          hasPort: !!process.env.SMTP_PORT,
          hasUser: !!process.env.SMTP_USER,
          hasPassword: !!process.env.SMTP_PASSWORD,
        }
      });
    }

    // Send test email
    const testUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/reset-password?token=test-token&id=test-id`;
    
    try {
      await sendPasswordResetEmail(email, 'Test User', testUrl);
      return res.status(200).json({ 
        success: true,
        message: 'Test email sent successfully',
        email,
      });
    } catch (error: any) {
      console.error('Test email error:', error);
      return res.status(500).json({ 
        error: 'Failed to send test email',
        message: error?.message,
        code: error?.code,
        details: process.env.NODE_ENV === 'development' ? error : 'Check server logs',
      });
    }
  } catch (error: unknown) {
    console.error('Test email handler error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: 'Failed to process test email request', message: errorMessage });
  }
}

