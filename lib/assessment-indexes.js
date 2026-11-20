'use strict';

/**
 * Phase 9 assessment indexes (docs/audits/phase-9-assessments.md, section 11).
 *
 *   A1 quizAttempts          { userId, lessonId, number }  unique  attempt identity; a student's
 *                                                                  attempts on a quiz, in order
 *   A2 assignmentSubmissions { userId, assignmentId }      unique  one submission per student and
 *                                                                  assignment (the submit route
 *                                                                  checks, then inserts)
 *   A3 quizAttempts          { lessonId, status, submittedAt: -1, _id: -1 }  results queue for staff
 *                                                                  (sorted submittedAt, then _id: the
 *                                                                  _id makes it an index-order merge,
 *                                                                  not an in-memory sort of the lesson)
 *   A4 quizzes               { lessonId }                  unique  one quiz per lesson (the quiz
 *                                                                  route upserts by lesson)
 *   A5 quizScores            { attemptId }    partial unique       one score per attempt; partial
 *                                                                  because rows from before Phase 9
 *                                                                  have no attemptId
 *   A6 quizScores            { userId, createdAt: -1, _id: -1 }    a student's history across quizzes
 *                                                                  (same sort as assessmentHistory)
 *
 * Attempt limits and the single open attempt do NOT depend on these indexes: they are enforced by
 * an atomic update on `quizAttemptCounters` (unique _id). A score row's _id is its attempt's _id,
 * so A5 is a second guarantee. A2 and A4 close races that exist today.
 *
 * Existing data may hold duplicates for A1, A2, A4 and A5. `assessmentIndexReport` counts them; building
 * refuses while any exist, and never deletes or merges documents (they need review). The
 * application never builds these; scripts/assessment-indexes.js does, read-only unless --apply.
 */

const { applyIndexPlan, blockedRows, classifyIndex, planIndexes } = require('./index-plan');

const ASSESSMENT_INDEXES = Object.freeze([
  Object.freeze({ id: 'A1', collection: 'quizAttempts', key: { userId: 1, lessonId: 1, number: 1 }, options: { name: 'quiz_attempt_user_lesson_number', unique: true }, duplicateKey: ['userId', 'lessonId', 'number'] }),
  Object.freeze({ id: 'A2', collection: 'assignmentSubmissions', key: { userId: 1, assignmentId: 1 }, options: { name: 'assignment_submission_user_assignment', unique: true }, duplicateKey: ['userId', 'assignmentId'] }),
  Object.freeze({ id: 'A3', collection: 'quizAttempts', key: { lessonId: 1, status: 1, submittedAt: -1, _id: -1 }, options: { name: 'quiz_attempt_lesson_results' } }),
  Object.freeze({ id: 'A4', collection: 'quizzes', key: { lessonId: 1 }, options: { name: 'quiz_lesson', unique: true }, duplicateKey: ['lessonId'] }),
  Object.freeze({ id: 'A5', collection: 'quizScores', key: { attemptId: 1 }, options: { name: 'quiz_score_attempt', unique: true, partialFilterExpression: { attemptId: { $type: 'string' } } }, duplicateKey: ['attemptId'] }),
  Object.freeze({ id: 'A6', collection: 'quizScores', key: { userId: 1, createdAt: -1, _id: -1 }, options: { name: 'quiz_score_user_recent' } }),
]);

/** present | missing | conflicting (lib/index-plan.js: same key and options, any name). */
function compareAssessmentIndex(definition, existing) {
  return classifyIndex(definition, existing).state;
}

/** State and duplicate count of every assessment index. Read-only. */
async function assessmentIndexReport(db) {
  return planIndexes(db, ASSESSMENT_INDEXES);
}

/**
 * Builds the missing indexes when `apply` is true. Refuses (builds nothing) while any index
 * conflicts or any unique index would meet duplicates. A4 in production is the existing
 * non-unique quizzes_lesson: it stays "conflicting" until the owner converts it in place
 * (scripts/quiz-lesson-unique.js); once unique it is "present" under that name.
 */
async function ensureAssessmentIndexes(db, { apply = false } = {}) {
  if (!apply) {
    const report = await planIndexes(db, ASSESSMENT_INDEXES);
    return { ok: blockedRows(report).length === 0, built: [], report };
  }
  return applyIndexPlan(db, ASSESSMENT_INDEXES);
}

module.exports = { ASSESSMENT_INDEXES, assessmentIndexReport, compareAssessmentIndex, ensureAssessmentIndexes };
