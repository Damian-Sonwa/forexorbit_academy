/** Password reset via SMS OTP — shared constants */
export const OTP_TTL_MS = 5 * 60 * 1000;
export const SMS_COOLDOWN_MS = 60 * 1000;
export const MAX_SMS_REQUESTS_PER_HOUR = 5;
export const MAX_OTP_VERIFY_ATTEMPTS = 3;
export const PASSWORD_STEP_TTL_MS = 15 * 60 * 1000;
export const PASSWORD_PHONE_RESETS_COLLECTION = 'passwordPhoneResets';
