'use strict';

/**
 * Account approval and rejection (POST /api/admin/approvals) and staff-role provisioning rules.
 *
 * Policy: approving or rejecting an account is reserved for the Super Admin. Only accounts that
 * are still pending can be decided; the Super Admin account and the caller's own account are
 * never targets. Every decision is written to the admin audit log. Granting or removing a
 * privileged role (instructor or admin) is likewise reserved for the Super Admin, so an ordinary
 * admin cannot create or remove staff by another route.
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

module.exports = {
  APPROVABLE_ROLES,
  APPROVAL_ACTIONS,
  PRIVILEGED_ROLES,
  PUBLIC_SIGNUP_ROLES,
  decideAccountApproval,
  decideApprovalRequest,
  decideApprovalTarget,
  decideRoleChange,
};
