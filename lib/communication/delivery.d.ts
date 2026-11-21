/** Types for lib/communication/delivery.js. */
import type { Db } from 'mongodb';
import type { ProviderEvent } from './resend-webhook';

export const EMAIL_STATES: readonly string[];
export const MAX_ATTEMPTS: number;
export const BACKOFF_MS: readonly number[];
export type DeliveryStats = {
  windowHours: number;
  email: Record<string, number>;
  queueDepth: number;
  retrying: number;
  push: Record<string, number>;
  suppressedAddresses: number;
  recentFailures: Array<{ id: string; type: string; category: string | null; state: string; reason: string | null; attempts: number; at: string | Date }>;
};
export function planChannels<T extends Record<string, unknown>>(copies: T[], users: Map<string, Record<string, unknown>>, now?: Date): T[];
export function realtimeEvent(doc: Record<string, unknown>): { id: string; type: string; category: string; createdAt: string };
export function backoff(attempts: number): number;
export function classify(error: unknown): { name: string; permanent: boolean };
export function processEmailQueue(db: Db, options: { send: (to: string, n: Record<string, unknown>, key: string, user: Record<string, unknown>) => Promise<unknown>; now?: Date; limit?: number }): Promise<Record<string, number>>;
export function applyProviderEvent(db: Db, event: ProviderEvent): Promise<{ applied: boolean; duplicate: boolean; matched: boolean; ignored?: boolean }>;
export function deliveryStats(db: Db, options?: { now?: Date; windowHours?: number }): Promise<DeliveryStats>;
