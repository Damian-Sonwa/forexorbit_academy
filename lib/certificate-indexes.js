'use strict';

/**
 * Unique certificate per student and course (Phase 4 certificate safeguards).
 *
 * Both issuing routes check for an existing certificate first, but two requests at the same moment
 * could both pass that check. The unique index makes the second insert fail (the routes then answer
 * "already issued"). It can only be built when no student/course pair already has two
 * certificates, and both fields must be stored the same way (strings), otherwise a string and an
 * ObjectId for the same id would not collide. `certificateIndexReport` checks both, read-only.
 */

const CERTIFICATE_UNIQUE_INDEX = Object.freeze({
  id: 'C1',
  collection: 'certificates',
  key: { userId: 1, courseId: 1 },
  options: { name: 'uniq_certificate_user_course', unique: true },
});

/** Read-only scan: duplicate pairs (after normalising ids to strings) and non-string ids. */
async function certificateIndexReport(db) {
  const rows = await db.collection('certificates').find({}, { projection: { userId: 1, courseId: 1 } }).toArray();
  const seen = new Map();
  let nonStringIds = 0;
  let missingIds = 0;
  for (const row of rows) {
    if (row.userId == null || row.courseId == null) missingIds += 1;
    if ((row.userId != null && typeof row.userId !== 'string') || (row.courseId != null && typeof row.courseId !== 'string')) nonStringIds += 1;
    const key = `${String(row.userId)}|${String(row.courseId)}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const duplicatePairs = [...seen.values()].filter((n) => n > 1).length;
  return {
    certificates: rows.length,
    duplicatePairs,
    nonStringIds,
    missingIds,
    safeToBuild: duplicatePairs === 0 && nonStringIds === 0 && missingIds === 0,
  };
}

module.exports = { CERTIFICATE_UNIQUE_INDEX, certificateIndexReport };
