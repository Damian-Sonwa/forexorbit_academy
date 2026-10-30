export const NAME_MAX_CHARS: number;
export function checkSignupFields(input: { email: unknown; password: unknown; name: unknown }):
  | { ok: true; email: string; name: string }
  | { ok: false; status: 400; error: string; code: string };
