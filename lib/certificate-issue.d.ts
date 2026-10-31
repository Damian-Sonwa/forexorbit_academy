export const MAX_REASON: number;
export function checkStaffCertificateInput(body: unknown):
  | { ok: true; lookup: { byId: string } | { byEmail: string }; courseId: string; reason: string; sendEmail: boolean }
  | { ok: false; status: 400; code: string; field: string; error: string };
export function decideStaffCertificateIssue(input: {
  completion: { complete: boolean; basis: string | null } | null | undefined;
  reason: string;
}): { ok: true; completionBasis: string; completionVerified: boolean } | { ok: false; status: 400; code: string; error: string };
export function isDuplicateKey(error: unknown): boolean;
