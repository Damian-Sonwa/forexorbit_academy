/** Types for lib/communication/web-push.js. */
import type { Db } from 'mongodb';

type Member = { userId: string; role: string };
export type Device = { id: string; label: string; createdAt: string | null; lastUsedAt: string | null; failures: number };
export const MAX_DEVICES: number;
export function vapidConfig(env?: Record<string, string | undefined>): { ok: true; publicKey: string; privateKey: string; subject: string } | { ok: false };
export function safeEndpoint(value: unknown): string | null;
export function readSubscription(input: unknown): { ok: true; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } } | { ok: false; status: number; error: string };
export function encrypt(payload: string, keys: { p256dh: string; auth: string }, options?: { salt?: Buffer; asPrivateKey?: string | null }): Buffer;
export function vapidHeader(endpoint: string, config: { publicKey: string; privateKey: string; subject: string }, now?: number): string;
export function sendPush(device: Record<string, unknown>, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ ok: boolean; status: number; gone: boolean; reason: string }>;
export function listDevices(db: Db, member: Member): Promise<{ ok: true; devices: Device[]; push: { available: boolean; publicKey: string | null } }>;
export function registerDevice(db: Db, member: Member, args: { subscription: unknown; label?: unknown; sessionFamilyId?: string | null; now?: Date }): Promise<{ ok: true; status: number; device: Device } | { ok: false; status: number; error: string }>;
export function revokeDevice(db: Db, member: Member, args: { deviceId: string }): Promise<{ ok: true } | { ok: false; status: number; error: string }>;
export function revokeSessionDevices(db: Db, userId: string, sessionFamilyId: string | null, options?: { all?: boolean }): Promise<void>;
export function processPushQueue(db: Db, options?: Record<string, unknown>): Promise<Record<string, number>>;
export function generateVapidKeys(): { publicKey: string; privateKey: string };
export function b64u(buf: Buffer | Uint8Array): string;
export function unb64u(text: string): Buffer;
