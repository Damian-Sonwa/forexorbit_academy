'use strict';

/**
 * Safeguards for staff-issued certificates (POST /api/admin/send-certificate).
 *
 * Who may issue is unchanged (admins and the Super Admin, decideStaffCertificate in
 * lib/enrollment-state.js), and staff may still issue a certificate without a recorded completion.
 * What changes: inputs must be plain strings; the certificate records how completion was
 * established (lib/course-progress.js `courseCompletion`); issuing without a verified completion
 * needs a written reason; every staff issue is audited; and a second certificate for the same
 * student and course is refused, also when two requests race (unique index, see
 * lib/certificate-indexes.js).
 */

const MAX_IDENTIFIER = 320;
const MAX_REASON = 500;
const HEX_ID = /^[a-f0-9]{24}$/i;

function inputError(field, error) {
  return { ok: false, status: 400, code: 'invalid_input', field, error };
}

/** Body of a staff issue: strings only, so no query operator can reach the database. */
function checkStaffCertificateInput(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (typeof source.studentIdentifier !== 'string' || !source.studentIdentifier.trim() || source.studentIdentifier.length > MAX_IDENTIFIER) {
    return inputError('studentIdentifier', 'Student identifier (ID or email) and course ID are required');
  }
  if (typeof source.courseId !== 'string' || !HEX_ID.test(source.courseId.trim())) {
    return inputError('courseId', 'Invalid course ID format');
  }
  if (source.reason !== undefined && (typeof source.reason !== 'string' || source.reason.length > MAX_REASON)) {
    return inputError('reason', `The reason must be text of at most ${MAX_REASON} characters.`);
  }
  const identifier = source.studentIdentifier.trim();
  return {
    ok: true,
    lookup: HEX_ID.test(identifier) ? { byId: identifier.toLowerCase() } : { byEmail: identifier },
    courseId: source.courseId.trim().toLowerCase(),
    reason: typeof source.reason === 'string' ? source.reason.trim() : '',
    sendEmail: source.sendEmail === true,
  };
}

/**
 * Whether a staff issue may proceed for this completion (from courseCompletion). A verified
 * completion ('recorded', 'current', 'historical') needs nothing more; otherwise a reason is
 * required and stored with the certificate and the audit entry.
 */
function decideStaffCertificateIssue({ completion, reason }) {
  const verified = Boolean(completion && completion.complete);
  const basis = completion && completion.basis ? completion.basis : 'not_completed';
  if (!verified && !reason) {
    return {
      ok: false,
      status: 400,
      code: 'reason_required',
      error: 'This student has no verified completion of the course. Add a reason to issue the certificate anyway.',
    };
  }
  return { ok: true, completionBasis: verified ? basis : `staff_override:${basis}`, completionVerified: verified };
}

function isDuplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));
}

module.exports = { MAX_REASON, checkStaffCertificateInput, decideStaffCertificateIssue, isDuplicateKey };
