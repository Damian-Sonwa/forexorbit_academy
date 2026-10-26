/**
 * Verify SMS OTP — returns one-time ticket + secret for /reset-password
 * POST /api/auth/verify-password-otp  { phone, otp }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { parseToE164, maskPhoneTail } from '@/lib/phone';
import { logPasswordResetEvent } from '@/lib/password-reset-log';
import {
  MAX_OTP_VERIFY_ATTEMPTS,
  PASSWORD_STEP_TTL_MS,
  PASSWORD_PHONE_RESETS_COLLECTION,
} from '@/lib/password-otp';

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
    const { phone, otp } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    if (!otp || typeof otp !== 'string') {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    const code = otp.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the 6-digit code from your SMS.' });
    }

    const parsed = parseToE164(phone);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    const phoneE164 = parsed.e164;

    const db = await getDb();
    const users = db.collection('users');
    const resets = db.collection(PASSWORD_PHONE_RESETS_COLLECTION);

    const user = await users.findOne({ phoneE164 });
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired code. Request a new code.' });
    }

    const doc = await resets.findOne({ userId: user._id });
    if (!doc?.otpHash) {
      return res.status(400).json({ error: 'Invalid or expired code. Request a new code.' });
    }

    if (doc.otpExpiresAt && new Date(doc.otpExpiresAt) < new Date()) {
      await resets.deleteMany({ userId: user._id });
      await logPasswordResetEvent(db, {
        event: 'otp_verify_fail',
        userId: user._id,
        phoneE164: maskPhoneTail(phoneE164),
        ip,
        detail: 'expired',
      });
      return res.status(400).json({ error: 'This code has expired. Request a new one.' });
    }

    if (doc.otpAttempts >= MAX_OTP_VERIFY_ATTEMPTS) {
      await resets.deleteMany({ userId: user._id });
      return res.status(400).json({
        error: 'Too many incorrect attempts. Request a new code.',
        locked: true,
      });
    }

    const ok = await bcrypt.compare(code, doc.otpHash);
    if (!ok) {
      const newAttempts = (doc.otpAttempts || 0) + 1;
      await resets.updateOne(
        { _id: doc._id },
        { $set: { otpAttempts: newAttempts, updatedAt: new Date() } }
      );
      await logPasswordResetEvent(db, {
        event: 'otp_verify_fail',
        userId: user._id,
        phoneE164: maskPhoneTail(phoneE164),
        ip,
        detail: `wrong_code_attempt_${newAttempts}`,
      });

      if (newAttempts >= MAX_OTP_VERIFY_ATTEMPTS) {
        await resets.deleteMany({ userId: user._id });
        await logPasswordResetEvent(db, {
          event: 'otp_locked',
          userId: user._id,
          phoneE164: maskPhoneTail(phoneE164),
          ip,
        });
        return res.status(400).json({
          error: 'Too many incorrect attempts. Request a new code.',
          locked: true,
        });
      }

      return res.status(400).json({
        error: 'Invalid code. Check the SMS and try again.',
        attemptsRemaining: MAX_OTP_VERIFY_ATTEMPTS - newAttempts,
      });
    }

    const resetTicket = crypto.randomBytes(24).toString('hex');
    const resetSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = await bcrypt.hash(resetSecret, 10);
    const passwordStepExpiresAt = new Date(Date.now() + PASSWORD_STEP_TTL_MS);

    await resets.updateOne(
      { _id: doc._id },
      {
        $set: {
          otpHash: null,
          otpExpiresAt: null,
          otpAttempts: 0,
          ticket: resetTicket,
          secretHash,
          passwordStepExpiresAt,
          updatedAt: new Date(),
        },
      }
    );

    await logPasswordResetEvent(db, {
      event: 'otp_verify_success',
      userId: user._id,
      phoneE164: maskPhoneTail(phoneE164),
      ip,
    });

    return res.status(200).json({
      message: 'Code verified. You can set a new password.',
      resetTicket,
      resetSecret,
    });
  } catch (error: unknown) {
    console.error('Verify password OTP error:', error);
    return res.status(500).json({ error: 'Failed to verify code' });
  }
}
