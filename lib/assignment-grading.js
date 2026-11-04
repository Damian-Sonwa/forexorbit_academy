'use strict';

/**
 * Assignment grading rules (Phase 9), used by pages/api/assignments/[id]/grade.ts and
 * pages/api/assignments/[id]/submit.ts. Rules: docs/audits/phase-9-assessments.md, section 9.
 *
 * Grades are percentages 0-100 (unchanged). Points for a graded submission are
 * round(grade / 100 x assignment points), half away from zero. A submission records the points it
 * has awarded (`pointsAwarded`), so a regrade adds only the difference: grading the same work
 * again can never add the points twice. Every grade is appended to `gradeHistory` with the grader
 * and time; the current grade is the last entry.
 *
 * Points cross two documents and transactions are not used here, so an award is recoverable: the
 * write that changes a submission also stores `pointsPending` ({ key, delta }), and
 * settlePendingPoints moves it to the user. The user update is conditional on the key not being
 * listed on the user and lists it in the same atomic write, so an interrupted award can be retried
 * any number of times and adds the points exactly once.
 */

const { ObjectId } = require('mongodb');

const MAX_FEEDBACK_LENGTH = 5000;

function gradePoints(grade, points) {
  if (!Number.isFinite(grade) || !Number.isFinite(points) || points <= 0) return 0;
  return Math.round((Math.min(100, Math.max(0, grade)) / 100) * points);
}

/**
 * Points this submission has already awarded for grading. Submissions graded before Phase 9 have
 * no `pointsAwarded`; they received gradePoints(grade, points) when graded, so that is used.
 */
function previouslyAwarded(submission, points) {
  if (!submission) return 0;
  if (typeof submission.pointsAwarded === 'number') return submission.pointsAwarded;
  // Any stored grade, whatever the status: before Phase 9 a resubmission set the status back to
  // 'submitted' and left the grade, so the points it had earned would otherwise be awarded again.
  if (typeof submission.grade === 'number') return gradePoints(submission.grade, points);
  return 0;
}

/**
 * Applies the award a submission still has pending. Safe to repeat. Returns true when one was
 * applied or finished here.
 */
async function settlePendingPoints(db, submission) {
  const pending = submission && submission.pointsPending;
  if (!pending || typeof pending.key !== 'string') return false;
  const userId = new ObjectId(String(submission.userId));
  const users = db.collection('users');
  await users.updateOne(
    { _id: userId, pointAwardKeys: { $ne: pending.key } },
    { $inc: { points: pending.delta }, $addToSet: { pointAwardKeys: pending.key } }
  );
  await db.collection('assignmentSubmissions').updateOne(
    { _id: submission._id, 'pointsPending.key': pending.key },
    { $unset: { pointsPending: '' } }
  );
  // Nothing can repeat this award now; a key left behind by a failure here is harmless.
  await users.updateOne({ _id: userId }, { $pull: { pointAwardKeys: pending.key } });
  return true;
}

/** Operator sweep (scripts/quiz-attempt-reconcile.js). Read-only unless `apply`. */
async function sweepPendingPoints(db, { apply = false, limit = 500 } = {}) {
  const filter = { pointsPending: { $exists: true } };
  const submissions = db.collection('assignmentSubmissions');
  const found = await submissions.countDocuments(filter);
  if (!apply) return { pending: found, settled: 0, failed: 0 };
  let settled = 0;
  let failed = 0;
  for (const row of await submissions.find(filter, { projection: { userId: 1, pointsPending: 1 } }).limit(limit).toArray()) {
    try {
      await settlePendingPoints(db, row);
      settled += 1;
    } catch {
      failed += 1;
    }
  }
  return { pending: found, settled, failed };
}

/** Whether a submission made at `submittedAt` is after the assignment's due date. */
function isLate(dueDate, submittedAt) {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  // A date without a time ("2026-11-20") means the whole day.
  if (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) due.setUTCHours(23, 59, 59, 999);
  return new Date(submittedAt).getTime() > due.getTime();
}

module.exports = { MAX_FEEDBACK_LENGTH, gradePoints, isLate, previouslyAwarded, settlePendingPoints, sweepPendingPoints };
