/** Types for lib/communication/moderation.js (also the frontend contract). */
import type { Db } from 'mongodb';

type Member = { userId: string; role: string; email?: string | null };
export type ModerationItem = {
  id: string; type: 'question' | 'reply'; questionId: string | null; title: string | null; excerpt: string; author: string; reportCount: number;
  reasons: Array<{ reason: string; label: string; count: number }>; details: string[]; status: string;
  history: Array<{ action: string; reason: string | null; at: string | null }>; createdAt: string | null;
};
export const REASONS: Readonly<Record<string, string>>;
export const ACTIONS: readonly string[];
export function report(db: Db, member: Member, body: unknown, options?: { now?: Date }): Promise<{ ok: true; status?: number; repeated?: boolean } | { ok: false; status: number; error: string }>;
export function queue(db: Db, member: Member, options?: { status?: string; limit?: number }): Promise<{ ok: true; items: ModerationItem[]; counts: { reported: number; hidden: number } } | { ok: false; status: number; error: string }>;
export function moderate(db: Db, member: Member, body: unknown, options?: { now?: Date }): Promise<{ ok: true; status?: number; moderation: string } | { ok: false; status: number; error: string }>;
