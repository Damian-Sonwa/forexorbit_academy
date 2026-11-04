'use strict';

/**
 * Phase 9 assessment indexes (docs/audits/phase-9-assessments.md, section 11).
 *
 *   A1 quizAttempts          { userId, lessonId, number }  unique  attempt identity; a student's
 *                                                                  attempts on a quiz, in order
 *   A2 assignmentSubmissions { userId, assignmentId }      unique  one submission per student and
 *                                                                  assignment (the submit route
 *                                                                  checks, then inserts)
 *   A3 quizAttempts          { lessonId, status, submittedAt: -1 } results queue for staff
 *   A4 quizzes               { lessonId }                  unique  one quiz per lesson (the quiz
 *                                                                  route upserts by lesson)
 *   A5 quizScores            { attemptId }    partial unique       one score per attempt; partial
 *                                                                  because rows from before Phase 9
 *                                                                  have no attemptId
 *   A6 quizScores            { userId, createdAt: -1 }             a student's history across quizzes
 *
 * Attempt limits and the single open attempt do NOT depend on these indexes: they are enforced by
 * an atomic update on `quizAttemptCounters` (unique _id). A score row's _id is its attempt's _id,
 * so A5 is a second guarantee. A2 and A4 close races that exist today.
 *
 * Existing data may hold duplicates for A1, A2, A4 and A5. `assessmentIndexReport` counts them; building
 * refuses while any exist, and never deletes or merges documents (they need review). The
 * application never builds these; scripts/assessment-indexes.js does, read-only unless --apply.
 */

const ASSESSMENT_INDEXES = Object.freeze([
  Object.freeze({ id: 'A1', collection: 'quizAttempts', key: { userId: 1, lessonId: 1, number: 1 }, options: { name: 'quiz_attempt_user_lesson_number', unique: true }, duplicateKey: ['userId', 'lessonId', 'number'] }),
  Object.freeze({ id: 'A2', collection: 'assignmentSubmissions', key: { userId: 1, assignmentId: 1 }, options: { name: 'assignment_submission_user_assignment', unique: true }, duplicateKey: ['userId', 'assignmentId'] }),
  Object.freeze({ id: 'A3', collection: 'quizAttempts', key: { lessonId: 1, status: 1, submittedAt: -1 }, options: { name: 'quiz_attempt_lesson_results' } }),
  Object.freeze({ id: 'A4', collection: 'quizzes', key: { lessonId: 1 }, options: { name: 'quiz_lesson', unique: true }, duplicateKey: ['lessonId'] }),
  Object.freeze({ id: 'A5', collection: 'quizScores', key: { attemptId: 1 }, options: { name: 'quiz_score_attempt', unique: true, partialFilterExpression: { attemptId: { $type: 'string' } } }, duplicateKey: ['attemptId'] }),
  Object.freeze({ id: 'A6', collection: 'quizScores', key: { userId: 1, createdAt: -1 }, options: { name: 'quiz_score_user_recent' } }),
]);

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** present | missing | conflicting (same name or key with another definition). */
function compareAssessmentIndex(definition, existing) {
  const exact = (index) => same(index.key, definition.key) && Boolean(index.unique) === Boolean(definition.options.unique)
    && same(index.partialFilterExpression, definition.options.partialFilterExpression) && !index.sparse;
  const byName = existing.find((index) => index.name === definition.options.name);
  if (byName) return exact(byName) ? 'present' : 'conflicting';
  if (existing.some((index) => same(index.key, definition.key))) return 'conflicting';
  return 'missing';
}

async function duplicateGroups(db, definition) {
  if (!definition.duplicateKey) return 0;
  const _id = Object.fromEntries(definition.duplicateKey.map((field) => [field, `$${field}`]));
  const partial = definition.options.partialFilterExpression;
  const rows = await db.collection(definition.collection).aggregate([
    ...(partial ? [{ $match: partial }] : []),
    { $group: { _id, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'groups' },
  ]).toArray();
  return rows.length ? rows[0].groups : 0;
}

/** State and duplicate count of every assessment index. Read-only. */
async function assessmentIndexReport(db) {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const report = [];
  for (const definition of ASSESSMENT_INDEXES) {
    const exists = names.has(definition.collection);
    const existing = exists ? await db.collection(definition.collection).indexes() : [];
    report.push({
      id: definition.id,
      collection: definition.collection,
      name: definition.options.name,
      state: exists ? compareAssessmentIndex(definition, existing) : 'no collection',
      duplicates: exists ? await duplicateGroups(db, definition) : 0,
    });
  }
  return report;
}

/**
 * Builds the missing indexes when `apply` is true. Refuses (builds nothing) while any index
 * conflicts or any unique index would meet duplicates.
 */
async function ensureAssessmentIndexes(db, { apply = false } = {}) {
  const before = await assessmentIndexReport(db);
  const blocked = before.filter((r) => r.state === 'conflicting' || r.duplicates > 0);
  if (!apply) return { ok: blocked.length === 0, built: [], report: before };
  if (blocked.length) return { ok: false, built: [], report: before, blocked: blocked.map((r) => r.id) };
  const built = [];
  for (const definition of ASSESSMENT_INDEXES) {
    const row = before.find((r) => r.id === definition.id);
    if (row.state === 'missing' || row.state === 'no collection') {
      await db.collection(definition.collection).createIndex(definition.key, definition.options);
      built.push(definition.id);
    }
  }
  const after = await assessmentIndexReport(db);
  return { ok: after.every((r) => r.state === 'present'), built, report: after };
}

module.exports = { ASSESSMENT_INDEXES, assessmentIndexReport, compareAssessmentIndex, ensureAssessmentIndexes };
