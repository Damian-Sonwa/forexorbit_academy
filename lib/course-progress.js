'use strict';

/**
 * Course progress and completion (Phase 4, Decision 4).
 *
 * `completedLessons` on a progress row is kept as history: ids are added, never removed, even
 * when a lesson is later deleted. Progress is always measured against the lessons the course has
 * now, counting only completed ids that still exist, and never exceeds 100. So a deleted lesson
 * can no longer inflate progress (audit M1), and adding a lesson lowers the percentage of new
 * material covered without erasing what was completed.
 *
 * Completion is a separate, permanent record: `completedAt` is set the first time a student has
 * completed every lesson the course has at that moment, and is never cleared. Certificates use
 * `courseCompletion`, which also recognises completions recorded before `completedAt` existed.
 */

// The pure calculations live in lib/progress-math.js (no dependencies; also bundled for the browser).
const { courseCompletion, currentCompletedIds, progressPercent } = require('./progress-math');

/**
 * The fields to store after progress changed. `completedAt` only when newly complete. A stored
 * value that cannot be verified is copied to `legacyProgress` (once) before it is replaced, so the
 * evidence stays available for review.
 */
function progressFields({ enrollment, currentLessonIds, now = new Date() }) {
  const completion = courseCompletion({ enrollment, currentLessonIds });
  const fields = { progress: completion.percent, updatedAt: now };
  if (completion.basis === 'unverified' && enrollment.legacyProgress === undefined) {
    fields.legacyProgress = enrollment.progress;
  }
  if (completion.complete && !(enrollment && enrollment.completedAt)) {
    fields.completedAt = completion.basis === 'historical' && enrollment && enrollment.updatedAt instanceof Date
      ? enrollment.updatedAt
      : now;
  }
  return fields;
}

function courseIdValues(courseId) {
  const values = [String(courseId)];
  try {
    const { ObjectId } = require('mongodb');
    if (ObjectId.isValid(String(courseId))) values.push(new ObjectId(String(courseId)));
  } catch {
    // mongodb is always installed on the server; tests may pass plain ids.
  }
  return values;
}

/** Current lesson ids of a course (ids only; lesson bodies are not read). */
async function currentLessonIdsFor(db, courseId) {
  const rows = await db.collection('lessons')
    .find({ courseId: String(courseId) }, { projection: { _id: 1 } })
    .toArray();
  return rows.map((row) => String(row._id));
}

/**
 * Records one completed lesson atomically ($addToSet, so parallel completions are all kept) and
 * stores the recomputed progress. Returns the stored percentage and completion.
 *
 * Phase 8: the recomputed percentage is written only while no newer completion has been added
 * (compare-and-set on the length of `completedLessons`, which only grows). Without it, two
 * parallel completions (two tabs, two devices) could store the older, lower percentage last.
 * Whichever request saw the longest list writes, so the stored value always matches the full
 * list. A completion that was already recorded leaves the row as it is (idempotent).
 */
async function recordLessonCompletion(db, { userId, courseId, lessonId, now = new Date() }) {
  const progress = db.collection('progress');
  const filter = { userId: String(userId), courseId: String(courseId) };
  const updated = await progress.findOneAndUpdate(
    filter,
    { $addToSet: { completedLessons: String(lessonId) }, $set: { updatedAt: now } },
    { returnDocument: 'after', includeResultMetadata: false }
  );
  if (!updated) return null;
  const currentLessonIds = await currentLessonIdsFor(db, courseId);
  const fields = progressFields({ enrollment: updated, currentLessonIds, now });
  const { completedAt, ...rest } = fields;
  const seen = Array.isArray(updated.completedLessons) ? updated.completedLessons.length : 0;
  await progress.updateOne({ ...filter, [`completedLessons.${seen}`]: { $exists: false } }, { $set: rest });
  if (completedAt) {
    // Conditional, so a parallel request cannot move an existing completion date.
    await progress.updateOne({ ...filter, completedAt: { $exists: false } }, { $set: { completedAt } });
  }
  return {
    progress: rest.progress,
    completedLessons: Array.isArray(updated.completedLessons) ? updated.completedLessons : [],
    completedAt: updated.completedAt || completedAt || null,
  };
}

/**
 * Recomputes stored progress for every enrolment of a course after its lessons changed (lesson
 * added or deleted). Never removes completed ids and never clears `completedAt`.
 */
async function recomputeCourseProgress(db, courseId, { now = new Date() } = {}) {
  const currentLessonIds = await currentLessonIdsFor(db, courseId);
  const rows = await db.collection('progress')
    .find({ courseId: { $in: courseIdValues(courseId) } }, { projection: { completedLessons: 1, progress: 1, completedAt: 1, updatedAt: 1, legacyProgress: 1 } })
    .toArray();
  const operations = [];
  for (const row of rows) {
    const fields = progressFields({ enrollment: row, currentLessonIds, now });
    const changed = fields.progress !== row.progress || (fields.completedAt && !row.completedAt);
    if (!changed) continue;
    const { completedAt, ...rest } = fields;
    operations.push({ updateOne: { filter: { _id: row._id }, update: { $set: rest } } });
    if (completedAt) {
      operations.push({ updateOne: { filter: { _id: row._id, completedAt: { $exists: false } }, update: { $set: { completedAt } } } });
    }
  }
  if (operations.length) await db.collection('progress').bulkWrite(operations, { ordered: true });
  return { rows: rows.length, updated: operations.length };
}

module.exports = {
  courseCompletion,
  courseIdValues,
  currentCompletedIds,
  currentLessonIdsFor,
  progressFields,
  progressPercent,
  recomputeCourseProgress,
  recordLessonCompletion,
};
