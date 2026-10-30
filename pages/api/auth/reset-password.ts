/**
 * Reset Password — after OTP verification (resetTicket + resetSecret from verify-password-otp)
 * POST /api/auth/reset-password  { resetTicket, resetSecret, password }
 *
 * The ticket is single-use: after the secret is checked, the reset record is claimed with one
 * atomic delete (ticket unexpired), so only one request can set the password for it. A successful
 * reset raises sessionGeneration, which signs out every existing session.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { logPasswordResetEvent } from '@/lib/password-reset-log';
import { maskPhoneTail } from '@/lib/phone';
import { PASSWORD_PHONE_RESETS_COLLECTION } from '@/lib/password-otp';
import { unexpectedBody } from '@/lib/public-error';
import { RESET_COMPLETE_RULES, createAuthLimiter, sendRefusal } from '@/lib/auth-rate-limit';
import { clientAddress } from '@/lib/client-ip';

const completeLimiter = createAuthLimiter(RESET_COMPLETE_RULES);

const TICKET_PATTERN = /^[a-f0-9]{48}$/;
const SECRET_PATTERN = /^[a-f0-9]{64}$/;
const INVALID_SESSION = 'This reset link is invalid or expired. Start again from Forgot password.';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = clientAddress(req) ?? undefined;

  try {
    const { resetTicket, resetSecret, password } = req.body;

    if (!resetTicket || !resetSecret || !password) {
      return res.status(400).json({ error: 'Reset session and new password are required' });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const ticket = typeof resetTicket === 'string' ? resetTicket : '';
    const secret = typeof resetSecret === 'string' ? resetSecret : '';
    if (!TICKET_PATTERN.test(ticket) || !SECRET_PATTERN.test(secret)) {
      return res.status(400).json({ error: INVALID_SESSION });
    }

    const limit = await completeLimiter.consume({ ip: ip ?? null, ticket, getDb });
    if (!limit.allowed) return sendRefusal(res, limit);

    const db = await getDb();
    const users = db.collection('users');
    const resets = db.collection(PASSWORD_PHONE_RESETS_COLLECTION);
    const now = new Date();

    const doc = await resets.findOne({ ticket });

    if (!doc?.secretHash) {
      return res.status(400).json({ error: INVALID_SESSION });
    }

    if (!doc.passwordStepExpiresAt || new Date(doc.passwordStepExpiresAt) <= now) {
      await resets.deleteMany({ userId: doc.userId });
      return res.status(400).json({
        error: 'Your reset session expired. Verify your code again from the beginning.',
      });
    }

    const secretOk = await bcrypt.compare(secret, doc.secretHash);
    if (!secretOk) {
      return res.status(400).json({
        error: 'Invalid reset session. Open the reset password page again from your phone flow.',
      });
    }

    // Claim the ticket: only one request can remove this record, so it is used at most once.
    const claimed = await resets.findOneAndDelete(
      { _id: doc._id, ticket, secretHash: doc.secretHash, passwordStepExpiresAt: { $gt: now } },
      { includeResultMetadata: false }
    );
    if (!claimed) {
      return res.status(400).json({ error: INVALID_SESSION });
    }

    const user = await users.findOne({ _id: claimed.userId as ObjectId });
    if (!user) {
      await resets.deleteMany({ userId: claimed.userId });
      return res.status(400).json({ error: INVALID_SESSION });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await users.updateOne(
      { _id: user._id },
      {
        $set: { password: hashedPassword, updatedAt: new Date() },
        $inc: { sessionGeneration: 1 },
      }
    );

    // Any other reset record for this account (an older code) is no longer needed.
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
    return res.status(500).json(unexpectedBody('reset-password', error));
  }
}
