/**
 * Forgot Password API Route
 * Generates reset token and sends password reset email
 * POST /api/auth/forgot-password
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

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

    // TODO: Send email with reset link
    // For now, log the reset URL (remove in production)
    console.log('Password reset link for', email, ':', resetUrl);
    
    // In production, use nodemailer or similar:
    // await sendPasswordResetEmail(user.email, user.name, resetUrl);

    return res.status(200).json({ 
      message: 'If an account with that email exists, a password reset link has been sent.' 
    });
  } catch (error: unknown) {
    console.error('Forgot password error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
}

