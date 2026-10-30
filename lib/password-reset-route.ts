/**
 * Shared wiring for the password reset routes: the service (lib/password-reset.js) with the real
 * database and Resend mailer, and how its results become responses.
 */

import type { NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import { passwordResetEmailReady, sendPasswordChangedEmail, sendPasswordResetEmail } from '@/lib/email';
import { createPasswordResetService, type PasswordResetResult } from '@/lib/password-reset';
import { sendRefusal } from '@/lib/auth-rate-limit';

export const passwordResetService = createPasswordResetService({
  getDb,
  mailer: { passwordResetEmailReady, sendPasswordResetEmail, sendPasswordChangedEmail },
});

export function sendResetResult(res: NextApiResponse, result: PasswordResetResult) {
  res.setHeader('Cache-Control', 'no-store');
  if (result.refusal) return sendRefusal(res, result.refusal);
  return res.status(result.status).json(result.body);
}
