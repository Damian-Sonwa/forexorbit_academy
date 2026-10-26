/**
 * Forgot Password — SMS OTP
 * POST /api/auth/forgot-password  { phone }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { parseToE164, maskPhoneTail } from '@/lib/phone';
import { sendPasswordResetOtpSms, isSmsConfigured } from '@/lib/sms';
import { logPasswordResetEvent } from '@/lib/password-reset-log';
import {
  OTP_TTL_MS,
  SMS_COOLDOWN_MS,
  MAX_SMS_REQUESTS_PER_HOUR,
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
  const genericMsg = 'If an account exists for that number, a verification code was sent.';

  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const parsed = parseToE164(phone);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    const phoneE164 = parsed.e164;

    const db = await getDb();
    const users = db.collection('users');
    const resets = db.collection(PASSWORD_PHONE_RESETS_COLLECTION);
    const logs = db.collection('passwordResetSecurityLogs');

    const user = await users.findOne({ phoneE164 });

    await logPasswordResetEvent(db, {
      event: 'otp_requested',
      userId: user?._id,
      phoneE164: maskPhoneTail(phoneE164),
      ip,
      detail: user ? 'user_found' : 'no_user',
    });

    if (!user) {
      return res.status(200).json({ message: genericMsg });
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sentLastHour = await logs.countDocuments({
      event: 'otp_sent',
      userId: user._id,
      createdAt: { $gte: hourAgo },
    });

    if (sentLastHour >= MAX_SMS_REQUESTS_PER_HOUR) {
      const oldest = await logs.findOne(
        { event: 'otp_sent', userId: user._id, createdAt: { $gte: hourAgo } },
        { sort: { createdAt: 1 } }
      );
      const retryAfterSeconds = oldest
        ? Math.max(1, Math.ceil((oldest.createdAt.getTime() + 60 * 60 * 1000 - Date.now()) / 1000))
        : 3600;
      return res.status(200).json({
        message: genericMsg,
        cooldown: retryAfterSeconds,
        rateLimited: true,
      });
    }

    const lastSent = await logs.findOne(
      { event: 'otp_sent', userId: user._id },
      { sort: { createdAt: -1 } }
    );
    if (lastSent && Date.now() - lastSent.createdAt.getTime() < SMS_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil(
        (SMS_COOLDOWN_MS - (Date.now() - lastSent.createdAt.getTime())) / 1000
      );
      return res.status(200).json({
        message: genericMsg,
        cooldown: retryAfterSeconds,
      });
    }

    if (!isSmsConfigured()) {
      console.warn('[forgot-password] SMS not configured (set Twilio or Termii env vars).');
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEV] Would send OTP to', phoneE164, '(SMS disabled)');
      }
      await logPasswordResetEvent(db, {
        event: 'otp_send_failed',
        userId: user._id,
        phoneE164: maskPhoneTail(phoneE164),
        ip,
        detail: 'sms_not_configured',
      });
      return res.status(200).json({
        message: genericMsg,
        ...(process.env.NODE_ENV === 'development'
          ? {
              _devNote:
                'SMS not configured — set TWILIO_* or TERMII_API_KEY. No code was sent.',
            }
          : {}),
      });
    }

    const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const otpHash = await bcrypt.hash(otp, 8);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    try {
      await sendPasswordResetOtpSms(phoneE164, otp);
    } catch (err: unknown) {
      console.error('[forgot-password] SMS send failed:', err);
      await logPasswordResetEvent(db, {
        event: 'otp_send_failed',
        userId: user._id,
        phoneE164: maskPhoneTail(phoneE164),
        ip,
        detail: err instanceof Error ? err.message : 'send_error',
      });
      return res.status(200).json({ message: genericMsg });
    }

    await resets.deleteMany({ userId: user._id });

    await resets.insertOne({
      userId: user._id,
      phoneE164,
      otpHash,
      otpExpiresAt,
      otpAttempts: 0,
      ticket: null,
      secretHash: null,
      passwordStepExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await logPasswordResetEvent(db, {
      event: 'otp_sent',
      userId: user._id,
      phoneE164: maskPhoneTail(phoneE164),
      ip,
    });

    return res.status(200).json({ message: genericMsg });
  } catch (error: unknown) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}
