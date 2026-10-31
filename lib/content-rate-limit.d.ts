import type { NextApiResponse } from 'next';
import type { Db } from 'mongodb';
import type { AuthRule, createAuthLimiter } from './auth-rate-limit';

type Limiter = ReturnType<typeof createAuthLimiter>;

export const WINDOW_MS: number;
export const AUTHORING_RULES: readonly AuthRule[];
export const UPLOAD_RULES: readonly AuthRule[];
export const authoringLimiter: Limiter;
export const uploadLimiter: Limiter;
export function allowRequest(
  limiter: Limiter,
  input: {
    userId: string;
    res: NextApiResponse;
    getDb: () => Promise<Db>;
    env?: Record<string, string | undefined>;
    now?: number;
  }
): Promise<boolean>;
