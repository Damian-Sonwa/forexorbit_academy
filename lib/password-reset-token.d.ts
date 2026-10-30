import type { Db, ObjectId } from 'mongodb';

export type LinkRefusalCode = 'invalid_token' | 'expired_token' | 'used_token' | 'superseded_token';
export type IndexDefinition = {
  id: string;
  collection: string;
  key: Record<string, 1 | -1>;
  options: { name: string; unique?: boolean; partialFilterExpression?: Record<string, unknown>; expireAfterSeconds?: number };
};

export const LINK_REFUSALS: Readonly<Record<LinkRefusalCode, string>>;
export const RESET_TOKENS_COLLECTION: string;
export const RESET_TOKEN_INDEXES: readonly IndexDefinition[];
export const RESET_TOKEN_RETENTION_SECONDS: number;
export const RESET_TOKEN_TTL_MS: number;

export function hashResetToken(token: string): string;
export function isWellFormedToken(token: unknown): token is string;
export function supersedeActiveTokens(db: Db, userId: ObjectId, now: Date): Promise<void>;
export function issueResetToken(
  db: Db,
  input: { userId: ObjectId; sessionGeneration: number; now?: Date }
): Promise<{ id: ObjectId; token: string; expiresAt: Date }>;
export function discardResetToken(db: Db, id: ObjectId): Promise<void>;
export function claimResetToken(
  db: Db,
  input: { token: string; now?: Date }
): Promise<{ ok: true; record: Record<string, unknown> & { _id: ObjectId; userId: ObjectId; sessionGeneration: number } } | { ok: false; code: LinkRefusalCode }>;
