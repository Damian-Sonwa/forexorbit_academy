import type { Db } from 'mongodb';
import type { ObjectId } from 'mongodb';

export type PasswordResetLogEvent =
  | 'otp_requested'
  | 'otp_generated'
  | 'otp_sms_attempt'
  | 'otp_sent'
  | 'otp_send_failed'
  | 'otp_verify_success'
  | 'otp_verify_fail'
  | 'otp_locked'
  | 'password_reset_complete';

const COLLECTION = 'passwordResetSecurityLogs';

export async function logPasswordResetEvent(
  db: Db,
  params: {
    event: PasswordResetLogEvent;
    userId?: ObjectId;
    phoneE164?: string;
    ip?: string;
    detail?: string;
  }
): Promise<void> {
  try {
    await db.collection(COLLECTION).insertOne({
      ...params,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error('[password-reset-log]', e);
  }
}
