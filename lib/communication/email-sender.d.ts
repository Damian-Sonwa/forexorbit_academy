/** Types for lib/communication/email-sender.js. */
export function readConfig(env?: Record<string, string | undefined>): { ok: true; apiKey: string; from: string; appBaseUrl: string } | { ok: false; reason: string };
export function renderNotificationEmail(input: { name?: unknown; title: string; message: string; category: string; href?: string | null; appBaseUrl: string }): { subject: string; html: string; text: string };
export function createEmailSender(options?: Record<string, unknown>): (to: string, n: Record<string, unknown>, key: string, user?: Record<string, unknown>) => Promise<{ ok: true; providerId: string | null } | { ok: false; error: { name: string } }>;
