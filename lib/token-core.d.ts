export interface TokenPayload {
  userId: string;
  email: string;
  role: 'superadmin' | 'admin' | 'instructor' | 'student';
  sv?: string;
}

export function generateToken(payload: TokenPayload): string;
export function verifyToken(token: string): TokenPayload;
export function extractToken(authHeader: string | null): string | null;
export function sessionBinding(userId: string, generation: number, key?: string): string;
export function decideSessionBinding(input: {
  userId?: string;
  binding?: unknown;
  generation?: number | null;
  key?: string;
  lookupError?: boolean;
}): { ok: true; status: 200 } | { ok: false; status: 401 | 500; error: string };
export function issueAuthToken(input: {
  userId: string;
  email: string;
  role: TokenPayload['role'];
  generation?: number | null;
  key?: string;
}): string;
