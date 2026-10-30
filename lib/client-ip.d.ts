import type { IncomingMessage } from 'http';

export const DEFAULT_TRUSTED_HOPS: number;
export function trustedHops(env?: Record<string, string | undefined>): number;
export function cleanAddress(value: unknown): string | null;
export function rateLimitAddress(ip: string): string | null;
export function clientAddress(
  req: Pick<IncomingMessage, 'headers' | 'socket'> | null | undefined,
  env?: Record<string, string | undefined>
): string | null;
