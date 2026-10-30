import type { Db } from 'mongodb';

type Refusal = { ok: false; status: number; error: string; code: string };

export const CURRENT_PASSWORD_MAX_CHARS: number;
export const SECURITY_LOG_COLLECTION: string;
export function changePassword(
  db: Db,
  input: {
    userId: string;
    currentPassword: unknown;
    newPassword: unknown;
    compare: (plain: string, hash: string) => Promise<boolean>;
    hash: (plain: string) => Promise<string>;
    ip?: string | null;
    now?: Date;
  }
): Promise<{ ok: true; status: 200; generation: number; user: { id: string; email: string; name: string; role: string } } | Refusal>;
export function signOutEverywhere(db: Db, input: { userId: string; ip?: string | null }): Promise<{ ok: true; status: 200 } | Refusal>;
