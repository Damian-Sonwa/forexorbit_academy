type Env = Record<string, string | undefined>;
type HeaderReader = (name: string) => string | null | undefined;
export type OriginRefusal = { ok: false; status: 403; error: string; code: string };

export const CSRF_HEADER: string;
export const CSRF_VALUE: string;
export const EXEMPT_PATHS: readonly string[];
export function appOriginConfig(env?: Env): { ok: true; origin: string | null } | { ok: false; error: string };
export function corsOrigin(origin: string | null | undefined, env?: Env): string | null;
export function decideRequestOrigin(input: { method?: string; pathname?: string; header: HeaderReader; env?: Env }): { ok: true } | OriginRefusal;
export function decideSocketOrigin(input: { header: HeaderReader; env?: Env }): { ok: true } | { ok: false; code: string };
export function isTrustedOrigin(origin: string, env?: Env): boolean;
export function normalizeOrigin(value: unknown): string | null;
export function requestOrigin(header: HeaderReader): string | null;
export function trustedOrigins(env?: Env): string[];
