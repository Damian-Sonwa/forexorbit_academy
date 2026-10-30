'use strict';

/**
 * Account approval and rejection (POST /api/admin/approvals), staff-role provisioning rules, and
 * role changes and account deletion through user management (PUT/DELETE /api/admin/users/:id).
 *
 * Policy: approving or rejecting an account is reserved for the Super Admin. Only accounts that
 * are still pending can be decided; the Super Admin account and the caller's own account are
 * never targets. Every decision is written to the admin audit log. Granting or removing a
 * privileged role (instructor or admin) is likewise reserved for the Super Admin, so an ordinary
 * admin cannot create or remove staff by another route. Deleting an account is reserved for the
 * Super Admin too, since deleting a pending account would otherwise act as a rejection. Role
 * changes and deletions are audited like decisions.
 */

const { ObjectId } = require('mongodb');
const { AUDIT_COLLECTION } = require('./course-payment');

const APPROVAL_ACTIONS = Object.freeze(['approve', 'reject']);
/** Roles an approval can apply to. A Super Admin is never pending and never a target. */
const APPROVABLE_ROLES = Object.freeze(['student', 'instructor', 'admin']);
/** Roles the public signup form may request. Staff above instructor are provisioned by the Super Admin. */
const PUBLIC_SIGNUP_ROLES = Object.freeze(['student', 'instructor']);
const HEX_ID = /^[a-fA-F0-9]{24}$/;

const isSuperAdmin = (actor) => Boolean(actor && actor.role === 'superadmin');

function refuse(status, error, code) {
  return { ok: false, status, error, code };
}

/** Caller-only checks, made before any database read. */
function decideApprovalRequest({ actor, userId, action }) {
  if (!isSuperAdmin(actor)) {
    return refuse(403, 'Only the Super Admin can approve or reject accounts.', 'superadmin_required');
  }
  if (!APPROVAL_ACTIONS.includes(action)) {
    return refuse(400, 'Invalid request. action must be "approve" or "reject".', 'invalid_action');
  }
  if (typeof userId !== 'string' || !HEX_ID.test(userId)) {
    return refuse(400, 'Invalid user ID.', 'invalid_user_id');
  }
  if (String(actor.userId) === userId) {
    return refuse(403, 'You cannot approve or reject your own account.', 'self_approval');
  }
  return { ok: true };
}

/** Checks on the stored account, in the order a reviewer would want them explained. */
function decideApprovalTarget(target) {
  if (!target) return refuse(404, 'User not found.', 'not_found');
  if (target.role === 'superadmin') {
    return refuse(403, 'The Super Admin account cannot be approved or rejected.', 'superadmin_protected');
  }
  if (!APPROVABLE_ROLES.includes(target.role)) {
    return refuse(400, 'This account cannot be approved or rejected.', 'unsupported_role');
  }
  if (target.status !== 'pending') {
    return refuse(409, 'This account has already been processed.', 'not_pending');
  }
  return { ok: true };
}

/**
 * Applies one decision. The status changes only if the account is still pending and is not the
 * Super Admin at the moment of the write, so two reviewers acting at once produce one decision.
 * Returns { ok, status, error?, code?, user? }.
 */
async function decideAccountApproval(db, { actor, userId, action, now = new Date() }) {
  const request = decideApprovalRequest({ actor, userId, action });
  if (!request.ok) return request;

  const users = db.collection('users');
  const _id = new ObjectId(userId);
  const target = await users.findOne({ _id }, { projection: { email: 1, name: 1, role: 1, status: 1 } });
  const check = decideApprovalTarget(target);
  if (!check.ok) return check;

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const update = await users.updateOne(
    { _id, status: 'pending', role: { $in: APPROVABLE_ROLES } },
    {
      $set: {
        status: newStatus,
        updatedAt: now,
        reviewedBy: actor.email || null,
        reviewedById: String(actor.userId),
        reviewedAt: now,
      },
    }
  );
  if (!update.matchedCount) {
    // Decided by someone else between the read and the write.
    return refuse(409, 'This account has already been processed.', 'not_pending');
  }

  const user = { id: userId, email: target.email, name: target.name, role: target.role, status: newStatus };

  // Two writes without a transaction (none are used in this codebase; they need a replica set).
  // If the audit entry fails, the decision is already saved and is reported as such, never as a
  // silent success; the reviewer and time also stay on the account (reviewedById, reviewedAt).
  try {
    await db.collection(AUDIT_COLLECTION).insertOne({
      entityType: 'account',
      entityId: userId,
      reference: null,
      action: action === 'approve' ? 'account_approved' : 'account_rejected',
      reason: '',
      before: { status: 'pending', role: target.role },
      after: { status: newStatus, role: target.role },
      actor: { userId: String(actor.userId), email: typeof actor.email === 'string' ? actor.email : null },
      createdAt: now,
    });
  } catch {
    return {
      ok: false,
      status: 500,
      error: 'The decision was saved, but the audit entry could not be written. Do not repeat the decision.',
      code: 'audit_write_failed',
      decisionSaved: true,
      user,
    };
  }

  return { ok: true, status: 200, user };
}

/** Roles that carry staff access. Granting or removing one is reserved for the Super Admin. */
const PRIVILEGED_ROLES = Object.freeze(['instructor', 'admin']);

/**
 * Role changes through user management (PUT /api/admin/users/:id). Any change that grants or
 * removes a privileged role (student <-> instructor, anything <-> admin) is staff provisioning
 * and is reserved for the Super Admin. The Super Admin's own role is never changed here.
 */
function decideRoleChange({ actor, currentRole, newRole }) {
  if (currentRole === 'superadmin') {
    return refuse(403, 'Cannot change Super Admin role', 'superadmin_protected');
  }
  const changesPrivilege =
    newRole !== currentRole && (PRIVILEGED_ROLES.includes(newRole) || PRIVILEGED_ROLES.includes(currentRole));
  if (changesPrivilege && !isSuperAdmin(actor)) {
    return refuse(403, 'Only the Super Admin can grant or remove instructor or admin roles.', 'superadmin_required');
  }
  return { ok: true };
}

/** Roles user management can assign. Super Admin is never assigned here. */
const ASSIGNABLE_ROLES = Object.freeze(['student', 'instructor', 'admin']);

/** Writes one account audit entry; resolves to true when written, false when the write failed. */
async function writeAccountAudit(db, { userId, action, before, after, actor, now, reason = '' }) {
  try {
    await db.collection(AUDIT_COLLECTION).insertOne({
      entityType: 'account',
      entityId: userId,
      reference: null,
      action,
      reason,
      before,
      after,
      actor: { userId: String(actor.userId), email: typeof actor.email === 'string' ? actor.email : null },
      createdAt: now,
    });
    return true;
  } catch {
    return false;
  }
}

/** Reported when a change is saved but its audit entry is not; the caller must not repeat it. */
function savedWithoutAudit(what, user) {
  return {
    ok: false,
    status: 500,
    error: `The ${what} was saved, but the audit entry could not be written. Do not repeat it.`,
    code: 'audit_write_failed',
    decisionSaved: true,
    user,
  };
}

/**
 * Changes one account's role (PUT /api/admin/users/:id) under decideRoleChange. The write applies
 * only if the role is still the one that was checked, so the audit entry's `before` is exact; a
 * change made by someone else in between is refused with 409. A request that keeps the current
 * role is accepted as before but not audited, since nothing changed.
 */
async function changeAccountRole(db, { actor, userId, role, now = new Date() }) {
  if (typeof userId !== 'string' || !userId) return refuse(400, 'Invalid user ID', 'invalid_user_id');
  if (!HEX_ID.test(userId)) return refuse(400, 'Invalid user ID format', 'invalid_user_id');
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return refuse(400, 'Invalid role. Must be admin, instructor, or student', 'invalid_role');
  }

  const users = db.collection('users');
  const _id = new ObjectId(userId);
  const target = await users.findOne({ _id }, { projection: { role: 1 } });
  if (!target) return refuse(404, 'User not found', 'not_found');

  const change = decideRoleChange({ actor, currentRole: target.role, newRole: role });
  if (!change.ok) return change;

  const update = await users.updateOne({ _id, role: target.role }, { $set: { role, updatedAt: now } });
  if (!update.matchedCount) {
    return refuse(409, 'This account was changed by someone else. Reload and try again.', 'concurrent_change');
  }
  const user = { id: userId, role };
  if (target.role === role) return { ok: true, status: 200, user };

  const audited = await writeAccountAudit(db, {
    userId,
    action: 'role_changed',
    before: { role: target.role },
    after: { role },
    actor,
    now,
  });
  return audited ? { ok: true, status: 200, user } : savedWithoutAudit('role change', user);
}

/** Caller-only checks for a deletion, made before any database read. */
function decideDeletionRequest({ actor, userId }) {
  if (!isSuperAdmin(actor)) {
    return refuse(403, 'Only the Super Admin can delete accounts.', 'superadmin_required');
  }
  if (typeof userId !== 'string' || !HEX_ID.test(userId)) {
    return refuse(400, 'Invalid user ID format', 'invalid_user_id');
  }
  if (String(actor.userId) === userId) {
    return refuse(400, 'Cannot delete your own account', 'self_deletion');
  }
  return { ok: true };
}

/**
 * Deletes one account (DELETE /api/admin/users/:id). Super Admin only; the Super Admin account and
 * the caller's own account are never deleted. The account is removed as before (hard delete); the
 * audit entry keeps its id, email, role and status so the deletion stays traceable.
 */
async function deleteAccount(db, { actor, userId, now = new Date() }) {
  const request = decideDeletionRequest({ actor, userId });
  if (!request.ok) return request;

  const users = db.collection('users');
  const _id = new ObjectId(userId);
  const target = await users.findOne({ _id }, { projection: { email: 1, role: 1, status: 1 } });
  if (!target) return refuse(404, 'User not found', 'not_found');
  if (target.role === 'superadmin') {
    return refuse(403, 'Cannot delete Super Admin account', 'superadmin_protected');
  }

  // The role condition keeps the Super Admin safe even if the record changed since it was read.
  const removed = await users.deleteOne({ _id, role: { $ne: 'superadmin' } });
  if (!removed.deletedCount) return refuse(404, 'User not found', 'not_found');

  const user = { id: userId, email: typeof target.email === 'string' ? target.email : null, role: target.role };
  const audited = await writeAccountAudit(db, {
    userId,
    action: 'account_deleted',
    before: { email: user.email, role: target.role, status: target.status == null ? null : String(target.status) },
    after: null,
    actor,
    now,
  });
  return audited ? { ok: true, status: 200, user } : savedWithoutAudit('deletion', user);
}

/**
 * Suspension and reactivation (PATCH /api/admin/users/:id { action, reason }).
 *
 * Mechanism only; no policy. Super Admin only, as for every other account decision. Suspending
 * moves an active account (status approved, or none on older records) to `suspended` and raises
 * sessionGeneration, so every session ends at once; login, the API, sockets and password reset
 * already refuse a suspended account. Reactivating moves a suspended account back to `approved`;
 * sessions stay ended and the person signs in again. Pending and rejected accounts belong to the
 * approval flow and are not changed here. The Super Admin account and the caller's own account
 * are never targets. A short reason is required and is stored in the audit entry only. Durations,
 * appeals and notifications are not part of this mechanism.
 */
const STATUS_ACTIONS = Object.freeze(['suspend', 'reactivate']);
const STATUS_REASON_MIN = 3;
const STATUS_REASON_MAX = 500;

function decideStatusRequest({ actor, userId, action, reason }) {
  if (!isSuperAdmin(actor)) {
    return refuse(403, 'Only the Super Admin can suspend or reactivate accounts.', 'superadmin_required');
  }
  if (!STATUS_ACTIONS.includes(action)) {
    return refuse(400, 'Invalid request. action must be "suspend" or "reactivate".', 'invalid_action');
  }
  if (typeof userId !== 'string' || !HEX_ID.test(userId)) {
    return refuse(400, 'Invalid user ID format', 'invalid_user_id');
  }
  if (String(actor.userId) === userId) {
    return refuse(403, 'You cannot suspend or reactivate your own account.', 'self_status_change');
  }
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < STATUS_REASON_MIN || text.length > STATUS_REASON_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    return refuse(400, `Give a reason of ${STATUS_REASON_MIN} to ${STATUS_REASON_MAX} characters.`, 'invalid_reason');
  }
  return { ok: true, reason: text };
}

async function changeAccountStatus(db, { actor, userId, action, reason, now = new Date() }) {
  const request = decideStatusRequest({ actor, userId, action, reason });
  if (!request.ok) return request;

  const users = db.collection('users');
  const _id = new ObjectId(userId);
  const target = await users.findOne({ _id }, { projection: { role: 1, status: 1 } });
  if (!target) return refuse(404, 'User not found', 'not_found');
  if (target.role === 'superadmin') {
    return refuse(403, 'The Super Admin account cannot be suspended.', 'superadmin_protected');
  }

  const current = target.status == null || target.status === '' ? null : String(target.status);
  const suspend = action === 'suspend';
  if (suspend && current !== null && current !== 'approved') {
    return refuse(409, current === 'suspended' ? 'This account is already suspended.' : 'Only active accounts can be suspended.', 'invalid_transition');
  }
  if (!suspend && current !== 'suspended') {
    return refuse(409, 'Only suspended accounts can be reactivated.', 'invalid_transition');
  }

  const actorId = String(actor.userId);
  const update = suspend
    ? { $set: { status: 'suspended', suspendedAt: now, suspendedById: actorId, updatedAt: now }, $inc: { sessionGeneration: 1 } }
    : { $set: { status: 'approved', reactivatedAt: now, reactivatedById: actorId, updatedAt: now }, $unset: { suspendedAt: '', suspendedById: '' } };
  // Applies only if the status is still the one checked and the account is not a Super Admin.
  const result = await users.updateOne({ _id, status: current, role: { $ne: 'superadmin' } }, update);
  if (!result.matchedCount) {
    return refuse(409, 'This account was changed by someone else. Reload and try again.', 'concurrent_change');
  }

  const newStatus = suspend ? 'suspended' : 'approved';
  const user = { id: userId, role: target.role, status: newStatus };
  const audited = await writeAccountAudit(db, {
    userId,
    action: suspend ? 'account_suspended' : 'account_reactivated',
    before: { status: current || 'approved', role: target.role },
    after: { status: newStatus, role: target.role },
    reason: request.reason,
    actor,
    now,
  });
  return audited ? { ok: true, status: 200, user } : savedWithoutAudit(suspend ? 'suspension' : 'reactivation', user);
}

module.exports = {
  APPROVABLE_ROLES,
  APPROVAL_ACTIONS,
  ASSIGNABLE_ROLES,
  PRIVILEGED_ROLES,
  PUBLIC_SIGNUP_ROLES,
  STATUS_ACTIONS,
  changeAccountRole,
  changeAccountStatus,
  decideAccountApproval,
  decideApprovalRequest,
  decideApprovalTarget,
  decideDeletionRequest,
  decideRoleChange,
  decideStatusRequest,
  deleteAccount,
};
