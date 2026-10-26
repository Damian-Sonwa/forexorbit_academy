export const SIGNUP_CONFLICT: {
  status: number;
  body: { error: string };
};

export function signupConflict(
  existingEmail: unknown,
  existingPhone: unknown
): { status: number; body: { error: string } } | null;

export function isDuplicateKey(error: unknown): boolean;
