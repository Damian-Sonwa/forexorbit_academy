/**
 * Reset Password API Route
 * Validates token and updates user password
 * POST /api/auth/reset-password
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, userId, password } = req.body;

    if (!token || !userId || !password) {
      return res.status(400).json({ error: 'Token, user ID, and new password are required' });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const db = await getDb();
    const users = db.collection('users');
    const passwordResets = db.collection('passwordResets');

    // Find reset token record
    const resetRecord = await passwordResets.findOne({ 
      userId: new ObjectId(userId) 
    });

    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Check if token has expired
    if (new Date() > resetRecord.expiresAt) {
      // Clean up expired token
      await passwordResets.deleteOne({ _id: resetRecord._id });
      return res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
    }

    // Verify token (compare hashed token)
    const isValidToken = await bcrypt.compare(token, resetRecord.token);
    if (!isValidToken) {
      return res.status(400).json({ error: 'Invalid reset token' });
    }

    // Find user
    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user password
    await users.updateOne(
      { _id: new ObjectId(userId) },
      { 
        $set: { 
          password: hashedPassword,
          updatedAt: new Date()
        } 
      }
    );

    // Delete used reset token (invalidate it)
    await passwordResets.deleteOne({ _id: resetRecord._id });

    // Delete any other reset tokens for this user (security: one-time use)
    await passwordResets.deleteMany({ userId: new ObjectId(userId) });

    return res.status(200).json({ 
      message: 'Password has been reset successfully. You can now login with your new password.' 
    });
  } catch (error: unknown) {
    console.error('Reset password error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: 'Failed to reset password' });
  }
}

