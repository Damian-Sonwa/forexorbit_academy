/**
 * Change Password (signed in)
 * POST /api/auth/change-password  { currentPassword, newPassword }
 *
 * Needs the current password and applies the password rule (8 characters to 72 bytes). Success
 * ends every existing session (sessionGeneration, and every stored session is revoked) and starts a
 * new session cookie for this device, so the caller stays signed in here only. A "password changed" email is sent when email is configured.
 * 400 for a wrong current password or a rejected new one (never 401, which would sign the caller
 * out), 409 if the account changed meanwhile, 429/503 from the rate limits.
 */

import type { NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { endAllSessions, startSession } from '@/lib/session-auth';
import { unexpectedBody } from '@/lib/public-error';
import { clientAddress } from '@/lib/client-ip';
import { PASSWORD_CHANGE_RULES, createAuthLimiter, sendRefusal } from '@/lib/auth-rate-limit';
import { changePassword } from '@/lib/account-security';
import { sendPasswordChangedEmail } from '@/lib/email';

const changeLimiter = createAuthLimiter(PASSWORD_CHANGE_RULES);

async function handler(req: AuthRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const ip = clientAddress(req);
    const limit = await changeLimiter.consume({ ip, email: req.user!.email || req.user!.userId, getDb });
    if (!limit.allowed) return sendRefusal(res, limit);

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const db = await getDb();
    const result = await changePassword(db, {
      userId: req.user!.userId,
      currentPassword: (body as { currentPassword?: unknown }).currentPassword,
      newPassword: (body as { newPassword?: unknown }).newPassword,
      compare: (plain, hash) => bcrypt.compare(plain, hash),
      hash: (plain) => bcrypt.hash(plain, 10),
      ip,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }

    await endAllSessions(db, result.user.id, 'password_changed');
    await startSession(res, db, { userId: result.user.id, sessionGeneration: result.generation });
    const notice = await sendPasswordChangedEmail({
      to: result.user.email,
      name: result.user.name,
      idempotencyKey: `password-changed/settings/${result.user.id}/${result.generation}`,
      method: 'settings',
    });
    if (!notice.ok) console.warn(JSON.stringify({ event: 'password_changed_email_not_sent', reason: notice.reason }));

    return res.status(200).json({
      message: 'Your password has been changed. Other devices have been signed out.',
    });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('change-password', error));
  }
}

export default withAuth(handler);
