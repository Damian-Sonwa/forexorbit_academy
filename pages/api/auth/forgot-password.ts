/**
 * Forgot Password API Route
 * Generates reset token and sends password reset email
 * POST /api/auth/forgot-password
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
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

    const db = await getDb();
    const users = db.collection('users');
    const passwordResets = db.collection('passwordResets');

    // Find user by email
    const user = await users.findOne({ email: email.toLowerCase().trim() });
    
    // Always return success to prevent email enumeration
    // Don't reveal if email exists or not
    if (!user) {
      return res.status(200).json({ 
        message: 'If an account with that email exists, a password reset link has been sent.' 
      });
    }

    // Generate secure random token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Hash the token before storing (security best practice)
    const hashedToken = await bcrypt.hash(resetToken, 10);
    
    // Token expires in 1 hour
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    // Delete any existing reset tokens for this user
    await passwordResets.deleteMany({ userId: user._id });

    // Save reset token to database
    await passwordResets.insertOne({
      userId: user._id,
      token: hashedToken,
      expiresAt,
      createdAt: new Date(),
    });

    // Generate reset URL - use request origin or environment variable
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
                    (req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/')) || 
                    'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}&id=${user._id.toString()}`;

    // Send password reset email
    try {
      if (isEmailConfigured()) {
        console.log('Attempting to send password reset email to:', user.email);
        console.log('SMTP Config:', {
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT,
          secure: process.env.SMTP_SECURE,
          user: process.env.SMTP_USER ? `${process.env.SMTP_USER.substring(0, 3)}...` : 'not set',
          passwordSet: !!process.env.SMTP_PASSWORD,
        });
        
        await sendPasswordResetEmail(user.email, user.name || 'User', resetUrl);
        console.log('✅ Password reset email sent successfully to', user.email);
      } else {
        // Email not configured - log the URL for manual use (development/testing)
        console.warn('❌ Email not configured. Password reset URL for', email, ':', resetUrl);
        console.log('To enable email sending, configure SMTP environment variables in Vercel:');
        console.log('- SMTP_HOST (e.g., smtp.gmail.com)');
        console.log('- SMTP_PORT (e.g., 587)');
        console.log('- SMTP_SECURE (true or false)');
        console.log('- SMTP_USER (your email address)');
        console.log('- SMTP_PASSWORD (your app password)');
      }
    } catch (emailError: any) {
      // Log detailed error for debugging
      console.error('❌ Failed to send password reset email:', emailError);
      console.error('Error details:', {
        message: emailError?.message,
        code: emailError?.code,
        command: emailError?.command,
        response: emailError?.response,
        responseCode: emailError?.responseCode,
        stack: emailError?.stack,
      });
      console.log('Password reset URL for', email, ':', resetUrl);
      // Continue - user can still reset password if they have the link
      // But log the error so it can be fixed
    }

    return res.status(200).json({ 
      message: 'If an account with that email exists, a password reset link has been sent.' 
    });
  } catch (error: unknown) {
    console.error('Forgot password error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
}

