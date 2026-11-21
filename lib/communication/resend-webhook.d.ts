/** Types for lib/communication/resend-webhook.js. */
export type ProviderEvent = { eventId: string; type: string; providerId: string | null; to: string | null; bounceType: string | null; at: Date };
export const TOLERANCE_S: number;
export function verify(rawBody: string, headers: Record<string, string | string[] | undefined>, secret: string, options?: { now?: number }): { ok: true; event: ProviderEvent } | { ok: false; status: number; error: string };
export function sign(rawBody: string, secret: string, options?: { id?: string; timestamp?: number }): Record<string, string>;
