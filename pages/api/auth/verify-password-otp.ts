/**
 * Verify SMS OTP — returns one-time ticket + secret for /reset-password
 * POST /api/auth/verify-password-otp  { phone, otp }
 *
 * Each code allows MAX_OTP_VERIFY_ATTEMPTS comparisons. An attempt is reserved with one atomic
 * update on the reset record (otpAttempts < max, code unexpired and unused) before the code is
 * compared, so simultaneous requests cannot compare more often than that. A correct code is
 * consumed by a second conditional update, so it yields exactly one ticket. Every failure gets the
 * same response, whether or not the number has an account or a code.
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
import { unexpectedBody } from '@/lib/public-error';
import { findUserByPhoneInput } from '@/lib/user-phone-lookup';
import { RESET_VERIFY_RULES, createAuthLimiter, sendRefusal } from '@/lib/auth-rate-limit';
import { clientAddress } from '@/lib/client-ip';

const verifyLimiter = createAuthLimiter(RESET_VERIFY_RULES);

const INVALID_CODE = 'Invalid or expired code. Check the SMS or request a new code.';

/** Compared when there is no code to check, so failures take about as long either way. */
const PLACEHOLDER_HASH = bcrypt.hashSync('placeholder-never-matches', 8);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = clientAddress(req) ?? undefined;

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

    const limit = await verifyLimiter.consume({ ip: ip ?? null, phone: phoneE164, getDb });
    if (!limit.allowed) return sendRefusal(res, limit);

    const db = await getDb();
    const users = db.collection('users');
    const resets = db.collection(PASSWORD_PHONE_RESETS_COLLECTION);
    const now = new Date();

    const user = await findUserByPhoneInput(users, phoneE164, phone);

    // Reserve one attempt on the newest live code, or nothing.
    const reserved = user
      ? await resets.findOneAndUpdate(
          {
            userId: user._id,
            otpHash: { $type: 'string' },
            otpExpiresAt: { $gt: now },
            otpAttempts: { $lt: MAX_OTP_VERIFY_ATTEMPTS },
          },
          { $inc: { otpAttempts: 1 }, $set: { updatedAt: now } },
          { sort: { createdAt: -1 }, returnDocument: 'after', includeResultMetadata: false }
        )
      : null;

    if (!reserved) {
      await bcrypt.compare(code, PLACEHOLDER_HASH);
      if (user) {
        // Expired codes are removed. A code whose attempts are used up is left in place: it can no
        // longer be reserved, and a correct attempt reserved earlier may still be finishing. It is
        // replaced by the next code request and removed by a completed reset.
        await resets.deleteMany({ userId: user._id, otpHash: { $type: 'string' }, otpExpiresAt: { $lte: now } });
        await logPasswordResetEvent(db, {
          event: 'otp_verify_fail',
          userId: user._id,
          phoneE164: maskPhoneTail(phoneE164),
          ip,
          detail: 'no_live_code',
        });
      }
      return res.status(400).json({ error: INVALID_CODE });
    }

    const ok = await bcrypt.compare(code, String(reserved.otpHash));
    if (!ok) {
      const exhausted = reserved.otpAttempts >= MAX_OTP_VERIFY_ATTEMPTS;
      await logPasswordResetEvent(db, {
        event: exhausted ? 'otp_locked' : 'otp_verify_fail',
        userId: user!._id,
        phoneE164: maskPhoneTail(phoneE164),
        ip,
        detail: `wrong_code_attempt_${reserved.otpAttempts}`,
      });
      return res.status(400).json({ error: INVALID_CODE });
    }

    const resetTicket = crypto.randomBytes(24).toString('hex');
    const resetSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = await bcrypt.hash(resetSecret, 10);
    const passwordStepExpiresAt = new Date(Date.now() + PASSWORD_STEP_TTL_MS);

    // Consume the code: only the first correct request matches, so one code yields one ticket.
    const consumed = await resets.updateOne(
      { _id: reserved._id, otpHash: reserved.otpHash, otpExpiresAt: { $gt: now } },
      {
        $set: {
          otpHash: null,
          otpExpiresAt: null,
          ticket: resetTicket,
          secretHash,
          passwordStepExpiresAt,
          updatedAt: new Date(),
        },
      }
    );
    if (!consumed.matchedCount) {
      return res.status(400).json({ error: INVALID_CODE });
    }

    await logPasswordResetEvent(db, {
      event: 'otp_verify_success',
      userId: user!._id,
      phoneE164: maskPhoneTail(phoneE164),
      ip,
    });

    return res.status(200).json({
      message: 'Code verified. You can set a new password.',
      resetTicket,
      resetSecret,
    });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('verify-password-otp', error));
  }
}
