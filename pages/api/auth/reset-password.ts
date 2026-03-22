/**
 * Reset Password — after OTP verification (resetTicket + resetSecret from verify-password-otp)
 * POST /api/auth/reset-password  { resetTicket, resetSecret, password }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { logPasswordResetEvent } from '@/lib/password-reset-log';
import { maskPhoneTail } from '@/lib/phone';
import { PASSWORD_PHONE_RESETS_COLLECTION } from '@/lib/password-otp';

function getClientIp(req: NextApiRequest): string | undefined {
  const x = req.headers['x-forwarded-for'];
  if (typeof x === 'string') return x.split(',')[0].trim();
  if (Array.isArray(x)) return x[0];
  const ra = req.socket?.remoteAddress;
  return typeof ra === 'string' ? ra : undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = getClientIp(req);

  try {
    const { resetTicket, resetSecret, password } = req.body;

    if (!resetTicket || !resetSecret || !password) {
      return res.status(400).json({ error: 'Reset session and new password are required' });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const db = await getDb();
    const users = db.collection('users');
    const resets = db.collection(PASSWORD_PHONE_RESETS_COLLECTION);

    const doc = await resets.findOne({ ticket: String(resetTicket) });

    if (!doc?.secretHash) {
      return res.status(400).json({
        error: 'This reset link is invalid or expired. Start again from Forgot password.',
      });
    }

    if (!doc.passwordStepExpiresAt || new Date(doc.passwordStepExpiresAt) < new Date()) {
      await resets.deleteMany({ userId: doc.userId });
      return res.status(400).json({
        error: 'Your reset session expired. Verify your code again from the beginning.',
      });
    }

    const secretOk = await bcrypt.compare(String(resetSecret), doc.secretHash);
    if (!secretOk) {
      return res.status(400).json({
        error: 'Invalid reset session. Open the reset password page again from your phone flow.',
      });
    }

    const user = await users.findOne({ _id: doc.userId as ObjectId });
    if (!user) {
      await resets.deleteMany({ userId: doc.userId });
      return res.status(404).json({ error: 'User not found' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await users.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );

    await resets.deleteMany({ userId: user._id });

    await logPasswordResetEvent(db, {
      event: 'password_reset_complete',
      userId: user._id,
      phoneE164: user.phoneE164 ? maskPhoneTail(String(user.phoneE164)) : undefined,
      ip,
    });

    return res.status(200).json({
      message: 'Password has been reset successfully. You can now sign in with your new password.',
    });
  } catch (error: unknown) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
}
