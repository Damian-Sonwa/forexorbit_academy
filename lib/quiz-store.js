'use strict';

/**
 * Saving a lesson's quiz (PUT /api/quizzes/[lessonId]). One quiz per lesson: an upsert on
 * { lessonId }, and each save is a new version.
 *
 * Without a unique index on quizzes.lessonId, two simultaneous first saves can both insert, and the
 * lesson then has two quizzes (A4 closes this; tests/integration/index-conflicts-mongo.test.js).
 * With it, MongoDB retries such an upsert on the server, so a duplicate-key error should not reach
 * the caller. If one does (an older server, or a write the server cannot retry), the save is
 * retried ONCE: the quiz then exists, so the retry updates it. Any other error, or a second
 * duplicate-key error, is thrown unchanged.
 */

const isDuplicateKey = (error) => Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));

async function saveQuizVersion(quizzes, { lessonId, set, now }) {
  const save = () => quizzes.findOneAndUpdate(
    { lessonId },
    { $set: set, $inc: { version: 1 }, $setOnInsert: { lessonId, createdAt: now } },
    { upsert: true, returnDocument: 'after', includeResultMetadata: false },
  );
  try {
    return await save();
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    return save();
  }
}

module.exports = { isDuplicateKey, saveQuizVersion };
