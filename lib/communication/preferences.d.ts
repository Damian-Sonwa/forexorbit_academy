/** Types for lib/communication/preferences.js. */
export type Channel = 'inApp' | 'email' | 'push';
export type Preferences = Record<Channel, Record<string, boolean>>;
export const CATEGORIES: Readonly<Record<string, { label: string; essential: boolean; help: string }>>;
export const CHANNELS: readonly Channel[];
export const DEFAULTS: Preferences;
export const TYPE_CATEGORY: Readonly<Record<string, string>>;
export function categoryOf(notification: { type?: string; category?: string } | null): string;
export function effectivePreferences(stored: unknown): Preferences;
export function readPreferencesUpdate(body: unknown): { ok: true; update: Partial<Preferences> } | { ok: false; status: number; error: string };
export function allows(stored: unknown, category: string, channel: Channel): boolean;
export function isActiveAccount(user: unknown): boolean;
