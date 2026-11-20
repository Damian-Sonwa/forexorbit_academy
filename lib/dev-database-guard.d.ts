export const PRODUCTION_DATABASE_NAMES: readonly string[];
export const NON_PRODUCTION_NAME: RegExp;
export function checkDevelopmentDatabase(env?: NodeJS.ProcessEnv): { ok: true } | { ok: false; reason: string };
export function assertDevelopmentDatabase(env?: NodeJS.ProcessEnv): void;
