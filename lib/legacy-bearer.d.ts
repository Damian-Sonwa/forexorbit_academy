export const LEGACY_BEARER_HARD_STOP: string;
export function legacyBearerWindow(
  env?: Record<string, string | undefined>,
  now?: Date
): { open: true; until: Date } | { open: false; reason: 'not_configured' | 'invalid_setting' | 'beyond_hard_stop' | 'ended' };
