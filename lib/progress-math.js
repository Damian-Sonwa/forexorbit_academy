'use strict';

/**
 * Pure course-progress calculations (Phase 4, Decision 4), with no dependencies so they can be
 * bundled into browser pages (lib/enrollment-state.js is). lib/course-progress.js re-exports them
 * and adds the database operations. Rules: docs/audits/phase-8-learning-progress.md, section 4.
 */

function idSet(values) {
  return new Set((Array.isArray(values) ? values : []).map(String));
}

/** Completed lesson ids that are still lessons of the course. */
function currentCompletedIds(completedLessons, currentLessonIds) {
  const current = idSet(currentLessonIds);
  return [...idSet(completedLessons)].filter((id) => current.has(id));
}

/** Percentage of the course's current lessons completed, 0..100. */
function progressPercent(completedLessons, currentLessonIds) {
  const total = idSet(currentLessonIds).size;
  if (total === 0) return 0;
  const done = currentCompletedIds(completedLessons, currentLessonIds).length;
  return Math.min(100, (done / total) * 100);
}

/**
 * Whether this enrolment has completed the course, and on what evidence:
 *   'recorded'   completedAt is set (permanent)
 *   'current'    every current lesson is completed now
 *   'historical' recorded before completedAt existed: the stored progress reached 100 and every
 *                completed id is still a lesson of the course, so the 100 was not produced by
 *                deleted lessons; lessons may have been added since (Decision 4 keeps it)
 * A stored 100 that includes ids of deleted lessons is not trusted ('unverified'); see
 * scripts/phase-4-course-migration.js (step 3), which reports such rows for review.
 */
function courseCompletion({ enrollment, currentLessonIds }) {
  const row = enrollment && typeof enrollment === 'object' ? enrollment : {};
  const percent = progressPercent(row.completedLessons, currentLessonIds);
  if (row.completedAt) return { complete: true, basis: 'recorded', percent };
  if (idSet(currentLessonIds).size > 0 && percent >= 100) return { complete: true, basis: 'current', percent };
  const completed = idSet(row.completedLessons);
  const current = idSet(currentLessonIds);
  const stale = [...completed].some((id) => !current.has(id));
  if (typeof row.progress === 'number' && row.progress >= 100 && completed.size > 0) {
    return stale
      ? { complete: false, basis: 'unverified', percent }
      : { complete: true, basis: 'historical', percent };
  }
  return { complete: false, basis: null, percent };
}

module.exports = { courseCompletion, currentCompletedIds, idSet, progressPercent };
