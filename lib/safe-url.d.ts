export const ALLOWED_SCHEMES: readonly string[];
export const MAX_URL_LENGTH: number;
export function safeLinkUrl(value: unknown, options?: { allowRelative?: boolean }): string | null;
export function isSafeLinkUrl(value: unknown, options?: { allowRelative?: boolean }): boolean;
