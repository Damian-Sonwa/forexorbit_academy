import type { Db } from 'mongodb';
import type { AppRole } from './account-access';

export interface SessionRecord {
  _id: string;
  userId: string;
  familyId: string;
  generation: number;
  createdAt: Date;
  familyCreatedAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  rotatedAt: Date | null;
  rotatedTo: string | null;
  revokedAt: Date | null;
  revokeReason: string | null;
}

export type SessionRefusalReason =
  | 'unknown' | 'revoked' | 'expired_absolute' | 'expired_idle' | 'reuse' | 'account' | 'generation';

export interface SessionAccount { userId: string; email: string; role: AppRole; status: string }

export type SessionRefusal = { ok: false; status: number; error: string; reason: SessionRefusalReason };

export const ABSOLUTE_LIFETIME_MS: number;
export const COOKIE_NAME: string;
export const IDLE_TIMEOUT_MS: number;
export const ROTATION_GRACE_MS: number;
export const ROTATION_INTERVAL_MS: number;
export const SESSION_COLLECTION: string;
export const TOKEN_PATTERN: RegExp;
export const TOUCH_INTERVAL_MS: number;

export function clearedSessionCookie(): string;
export function cookieMaxAgeSeconds(session: Pick<SessionRecord, 'absoluteExpiresAt'>, now?: Date): number;
export function createSession(db: Db, input: { userId: string; generation: number; now?: Date }): Promise<{ token: string; session: SessionRecord }>;
export function decideSession(input: { session: SessionRecord | null; user: unknown; now?: Date }):
  | { ok: true; user: SessionAccount; grace: boolean; rotate: boolean; touch: boolean }
  | SessionRefusal;
export function endAccountSessions(db: Db, userId: string, reason: string, now?: Date): Promise<void>;
export function generationOf(user: unknown): number;
export function hashToken(token: string): string;
export function logSessionEvent(db: Db, event: string, input?: { userId?: string; detail?: string }): Promise<void>;
export function readSessionCookie(cookieHeader: string | string[] | undefined | null): string | null;
export function resolveSession(db: Db, token: string, options?: { now?: Date; rotate?: boolean }): Promise<
  | { ok: true; user: SessionAccount; session: SessionRecord; token: string | null }
  | SessionRefusal
>;
export function revokeFamily(db: Db, familyId: string, reason: string, now?: Date): Promise<number>;
export function revokeSessionById(db: Db, id: string, reason: string, now?: Date): Promise<number>;
export function revokeUserSessions(db: Db, userId: string, reason: string, now?: Date): Promise<number>;
export function rotateSession(db: Db, session: SessionRecord, now?: Date): Promise<{ token: string; session: SessionRecord } | null>;
export function sessionCookie(token: string, maxAgeSeconds: number): string;
