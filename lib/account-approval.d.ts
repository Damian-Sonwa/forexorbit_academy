import type { Db } from 'mongodb';

export type ApprovalActor = { userId: string; email?: string | null; role: string };
export type ApprovalUser = { id: string; email: string; name: string; role: string; status: string };
export type ApprovalRefusal = { ok: false; status: number; error: string; code: string };

export const APPROVABLE_ROLES: readonly string[];
export const APPROVAL_ACTIONS: readonly string[];
export const PRIVILEGED_ROLES: readonly string[];
export const PUBLIC_SIGNUP_ROLES: readonly string[];

export function decideApprovalRequest(input: {
  actor: ApprovalActor | null | undefined;
  userId: unknown;
  action: unknown;
}): { ok: true } | ApprovalRefusal;

export function decideApprovalTarget(
  target: { role?: unknown; status?: unknown } | null | undefined
): { ok: true } | ApprovalRefusal;

export function decideAccountApproval(
  db: Db,
  input: { actor: ApprovalActor; userId: unknown; action: unknown; now?: Date }
): Promise<
  | { ok: true; status: 200; user: ApprovalUser }
  | ApprovalRefusal
  | { ok: false; status: 500; error: string; code: 'audit_write_failed'; decisionSaved: true; user: ApprovalUser }
>;

export function decideRoleChange(input: {
  actor: ApprovalActor | null | undefined;
  currentRole: unknown;
  newRole: unknown;
}): { ok: true } | ApprovalRefusal;
