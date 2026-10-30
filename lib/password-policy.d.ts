export const PASSWORD_MIN_CHARS: number;
export const PASSWORD_MAX_BYTES: number;
export function checkNewPassword(password: unknown): { ok: true } | { ok: false; code: 'weak_password'; error: string };
