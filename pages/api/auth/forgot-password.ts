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
import { unexpectedBody } from '@/lib/public-error';
import { findUserByPhoneInput } from '@/lib/user-phone-lookup';
import {
  RESET_COOLDOWN_RULES,
  RESET_COOLDOWN_WINDOW_MS,
  RESET_REQUEST_RULES,
  createAuthLimiter,
  sendRefusal,
} from '@/lib/auth-rate-limit';
import { clientAddress } from '@/lib/client-ip';

const requestLimiter = createAuthLimiter(RESET_REQUEST_RULES);
/** At most one code per number per minute, counted atomically (the log check below is a second layer). */
const perNumberLimiter = createAuthLimiter(RESET_COOLDOWN_RULES, { windowMs: RESET_COOLDOWN_WINDOW_MS });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = clientAddress(req) ?? undefined;
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

    // Counted for every valid number, before the account lookup and any SMS, so a refusal says
    // nothing about whether the number has an account.
    const limit = await requestLimiter.consume({ ip: ip ?? null, phone: phoneE164, getDb });
    if (!limit.allowed) return sendRefusal(res, limit);
    const perNumber = await perNumberLimiter.consume({ ip: null, phone: phoneE164, getDb });
    if (!perNumber.allowed) {
      // Store unreachable: refused like the other limits. Within the minute: the usual silent answer.
      if (perNumber.status === 503) return sendRefusal(res, perNumber);
      return res.status(200).json({ message: genericMsg });
    }

    const db = await getDb();
    const users = db.collection('users');
    const resets = db.collection(PASSWORD_PHONE_RESETS_COLLECTION);
    const logs = db.collection('passwordResetSecurityLogs');

    const user = await findUserByPhoneInput(users, phoneE164, phone);

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
      return res.status(200).json({ message: genericMsg });
    }

    const lastSent = await logs.findOne(
      { event: 'otp_sent', userId: user._id },
      { sort: { createdAt: -1 } }
    );
    if (lastSent && Date.now() - lastSent.createdAt.getTime() < SMS_COOLDOWN_MS) {
      return res.status(200).json({ message: genericMsg });
    }

    if (!isSmsConfigured()) {
      console.warn('[forgot-password] SMS is not configured');
      await logPasswordResetEvent(db, {
        event: 'otp_send_failed',
        userId: user._id,
        phoneE164: maskPhoneTail(phoneE164),
        ip,
        detail: 'sms_not_configured',
      });
      return res.status(200).json({ message: genericMsg });
    }

    const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const otpHash = await bcrypt.hash(otp, 8);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    try {
      await sendPasswordResetOtpSms(phoneE164, otp);
    } catch {
      console.error('[forgot-password] SMS send failed');
      await logPasswordResetEvent(db, {
        event: 'otp_send_failed',
        userId: user._id,
        phoneE164: maskPhoneTail(phoneE164),
        ip,
        detail: 'sms_send_failed',
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
    return res.status(500).json(unexpectedBody('forgot-password', error));
  }
}
