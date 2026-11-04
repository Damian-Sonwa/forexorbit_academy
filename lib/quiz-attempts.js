'use strict';

/**
 * Lesson quiz attempts (Phase 9): the server is the only authority for who may attempt, how many
 * attempts there are, the deadline, the saved answers, the score and the result.
 *
 * Records
 *   quizAttempts         one document per attempt: owner, quiz, number, status, startedAt,
 *                        deadlineAt, the frozen questions (order, options, answer key, points),
 *                        the pass mark at start, saved answers, result. Never sent raw to a student.
 *   quizAttemptCounters  _id "<userId>:<lessonId>": `count` (attempt numbers handed out) and
 *                        `openAttemptId` (the attempt in progress, if any). Reserving a number and
 *                        the single open slot is one atomic update on a unique _id, so refreshes,
 *                        other tabs or concurrent requests can never exceed the attempt limit or
 *                        open a second attempt, even before the Phase 9 indexes exist.
 *
 * Lifecycle: in_progress -> submitted (student submits before the deadline + grace),
 *            in_progress -> expired (deadline + grace passed; graded on the saved answers), or
 *            in_progress -> cancelled (the lesson was deleted; no result).
 * Terminal states are final: every transition is a conditional update on status 'in_progress',
 * so only one request can finalize an attempt.
 *
 * Durable effects. MongoDB transactions are not used anywhere in this application and are not
 * available on a standalone server, so finishing an attempt is a recoverable workflow:
 *   1. one atomic update stores the terminal state, the result and `effectsPending: true`;
 *   2. reconcileAttempt applies the effects, each idempotent: the open slot on the counter, the
 *      quizScores row (its _id is the attempt's _id, so there can only ever be one) and the lesson
 *      completion ($addToSet);
 *   3. only then is `effectsPending` cleared.
 * A failure at any step leaves the flag set and the caller gets an error, not a result. Any later
 * submit, read, overview or start for that attempt finishes the work, and so does
 * scripts/quiz-attempt-reconcile.js for students who never come back.
 */

const { ObjectId } = require('mongodb');
const { decideAccountAccess, decideLessonRoomAccess, isStoredId } = require('./account-access');
const { enrollmentDecisionRecord } = require('./enrollment-state');
const { courseContentAccess, LESSON_LOCKED_MESSAGE } = require('./course-lesson-list');
const { recordLessonCompletion } = require('./course-progress');
const {
  FINISHED_STATUSES,
  SUBMIT_GRACE_SECONDS,
  attemptCompletesLesson,
  attemptDeadline,
  attemptOverdue,
  buildAttemptQuestions,
  quizAvailability,
  quizSettings,
  reviewAllowed,
  scoreAttempt,
} = require('./quiz-assessment');

const COLLECTIONS = Object.freeze({ attempts: 'quizAttempts', counters: 'quizAttemptCounters', scores: 'quizScores' });
const STAFF = new Set(['instructor', 'admin', 'superadmin']);
const START_ROUNDS = 5;
const RESULTS_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
/** Overdue attempts settled per staff results read; the rest go with the next read or the sweep. */
const RESULTS_SETTLE_LIMIT = 50;
/** Questions without the answer key, for reads that never start an attempt. */
const NO_ANSWER_KEY = Object.freeze({ 'questions.correctAnswer': 0, 'questions.explanation': 0 });

function refuse(status, code, error) {
  return { ok: false, status, code, error };
}

function isDuplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));
}

const counterId = (userId, lessonId) => `${userId}:${lessonId}`;

/**
 * Who is asking and what they may do with this lesson's quiz. Students: own active enrollment,
 * course open to students, prerequisite rule (decideLessonRoomAccess) and the Phase 6 paywall
 * (courseContentAccess). Staff: the course instructor or an admin (authoring and results).
 * `withAnswerKey` is set only by the paths that freeze questions into an attempt: students' other
 * reads never load the key, even on the server.
 */
async function loadQuizContext(db, { userId, lessonId, withAnswerKey = false }) {
  if (!isStoredId(lessonId)) return refuse(400, 'invalid_lesson', 'Invalid lesson ID');
  const record = await db.collection('users').findOne({ _id: new ObjectId(userId) }, { projection: { email: 1, role: 1, status: 1 } });
  const account = decideAccountAccess({ userId, record });
  if (!account.ok) return refuse(403, 'not_authorized', 'Not authorized');
  const member = account.user;
  const lesson = await db.collection('lessons').findOne({ _id: new ObjectId(lessonId) }, { projection: { courseId: 1, requiredLevel: 1, title: 1 } });
  const course = lesson && isStoredId(String(lesson.courseId))
    ? await db.collection('courses').findOne({ _id: new ObjectId(String(lesson.courseId)) }, { projection: { instructorId: 1, difficulty: 1, status: 1, title: 1 } })
    : null;
  if (!lesson || !course) return refuse(404, 'lesson_not_found', 'Lesson not found');
  const courseId = String(course._id);
  const enrollment = await db.collection('progress').findOne({ userId: member.userId, $or: [{ courseId }, { courseId: course._id }] });
  const access = decideLessonRoomAccess({
    member,
    lesson: { _id: lesson._id, courseId: lesson.courseId, requiredLevel: typeof lesson.requiredLevel === 'string' ? lesson.requiredLevel : null },
    course: { _id: course._id, instructorId: course.instructorId, difficulty: typeof course.difficulty === 'string' ? course.difficulty : null, status: course.status },
    enrollment: enrollmentDecisionRecord(enrollment),
  });
  if (!access.ok) return refuse(403, 'not_authorized', 'Unable to access lesson');
  const staff = STAFF.has(member.role);
  if (!staff) {
    const content = await courseContentAccess(db, member, courseId);
    if (!content.isOpen(String(lesson._id))) return refuse(403, 'lesson_locked', LESSON_LOCKED_MESSAGE);
  }
  const quiz = await db.collection('quizzes').findOne(
    { lessonId: String(lesson._id) },
    staff || withAnswerKey ? undefined : { projection: NO_ANSWER_KEY }
  );
  return { ok: true, member, staff, lesson, course, courseId, lessonId: String(lesson._id), quiz };
}

async function loadOwnAttempt(db, ctx, attemptId) {
  if (!isStoredId(attemptId)) return null;
  return db.collection(COLLECTIONS.attempts).findOne({ _id: new ObjectId(attemptId), userId: ctx.member.userId, lessonId: ctx.lessonId });
}

async function ownAttempts(db, ctx) {
  return db.collection(COLLECTIONS.attempts)
    .find({ userId: ctx.member.userId, lessonId: ctx.lessonId }, { projection: { questions: 0 } })
    .sort({ number: 1 })
    .toArray();
}

async function releaseOpenSlot(db, attempt, now) {
  await db.collection(COLLECTIONS.counters).updateOne(
    { _id: counterId(attempt.userId, attempt.lessonId), openAttemptId: String(attempt._id) },
    { $set: { openAttemptId: null, updatedAt: now } }
  );
}

/** The one quizScores row of an attempt, built from the stored result. A repeat is a no-op. */
async function writeScoreRow(db, attempt) {
  const result = attempt.result;
  try {
    await db.collection(COLLECTIONS.scores).insertOne({
      _id: attempt._id,
      userId: attempt.userId,
      lessonId: attempt.lessonId,
      courseId: attempt.courseId,
      attemptId: String(attempt._id),
      attemptNumber: attempt.number,
      score: result.percent,
      percentage: result.percent,
      correct: result.correctCount,
      totalQuestions: result.total,
      earned: result.earned,
      available: result.available,
      passed: result.passed,
      status: attempt.status,
      createdAt: attempt.finalizedAt,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
}

/** Idempotent ($addToSet); only while the lesson is still open to the student (Phase 6). */
async function completeLesson(db, attempt, now) {
  if (!attemptCompletesLesson(attempt)) return;
  const content = await courseContentAccess(db, { userId: attempt.userId, role: 'student' }, attempt.courseId);
  if (content.isOpen(attempt.lessonId)) {
    await recordLessonCompletion(db, { userId: attempt.userId, courseId: attempt.courseId, lessonId: attempt.lessonId, now });
  }
}

/**
 * Finishes the durable effects of a finalized attempt. Safe to repeat and to run concurrently.
 * Throws if an effect fails, with `effectsPending` still set, so nothing reports success early.
 */
async function reconcileAttempt(db, attempt, now = new Date()) {
  if (!attempt || !attempt.effectsPending) return attempt;
  await releaseOpenSlot(db, attempt, now);
  await writeScoreRow(db, attempt);
  await completeLesson(db, attempt, now);
  await db.collection(COLLECTIONS.attempts).updateOne(
    { _id: attempt._id, effectsPending: true },
    { $unset: { effectsPending: '' }, $set: { effectsAppliedAt: now } }
  );
  const { effectsPending, ...settled } = attempt;
  return { ...settled, effectsAppliedAt: now };
}

/** Moves an attempt to a terminal state once. Whoever loses the race gets the stored outcome. */
async function finalizeAttempt(db, attempt, { status, answers, now }) {
  const result = scoreAttempt(attempt.questions, answers, attempt.passingPercent);
  const submittedAt = status === 'expired' && attempt.deadlineAt ? new Date(attempt.deadlineAt) : now;
  await db.collection(COLLECTIONS.attempts).updateOne(
    { _id: attempt._id, status: 'in_progress' },
    { $set: { status, answers, result, submittedAt, finalizedAt: now, updatedAt: now, effectsPending: true } }
  );
  const stored = await db.collection(COLLECTIONS.attempts).findOne({ _id: attempt._id });
  return reconcileAttempt(db, stored, now);
}

/** Expires an attempt whose time, grace included, is over (graded on the answers saved in time). */
async function settleExpired(db, attempt, now) {
  if (attempt && attempt.status === 'in_progress' && attemptOverdue(attempt, now)) {
    return finalizeAttempt(db, attempt, { status: 'expired', answers: attempt.answers || {}, now });
  }
  return attempt;
}

/** Finishes this student's interrupted attempts on this quiz. */
async function reconcileOwnAttempts(db, ctx, now) {
  const rows = await db.collection(COLLECTIONS.attempts)
    .find({ userId: ctx.member.userId, lessonId: ctx.lessonId, effectsPending: true }, { projection: { questions: 0 } })
    .toArray();
  for (const row of rows) await reconcileAttempt(db, row, now);
}

/**
 * Starts an attempt, or returns the one already in progress (a refresh, another tab or a retried
 * request never creates a second one). Refused when the quiz is not available or the attempt
 * limit is used up.
 */
async function startAttempt(db, ctx, { now = new Date(), random = Math.random } = {}) {
  if (ctx.member.role !== 'student') return refuse(403, 'students_only', 'Only students take quizzes.');
  const counters = db.collection(COLLECTIONS.counters);
  const attempts = db.collection(COLLECTIONS.attempts);
  const id = counterId(ctx.member.userId, ctx.lessonId);
  await reconcileOwnAttempts(db, ctx, now);
  for (let round = 0; round < START_ROUNDS; round += 1) {
    const current = await counters.findOne({ _id: id });
    if (current && current.openAttemptId) {
      let open = await attempts.findOne({ _id: new ObjectId(current.openAttemptId), userId: ctx.member.userId });
      if (!open) open = await recreateReservedAttempt(db, ctx, current, now, random);
      if (!open) return refuse(404, 'quiz_not_found', 'Quiz not found');
      open = await settleExpired(db, open, now);
      if (open.status === 'in_progress') return { ok: true, attempt: open, resumed: true };
      await reconcileAttempt(db, open, now);
      await releaseOpenSlot(db, open, now); // A finished attempt never keeps the slot.
      continue;
    }
    const availability = quizAvailability(ctx.quiz, now);
    if (!availability.ok) return availability;
    const settings = availability.settings;
    if (settings.maxAttempts && current && current.count >= settings.maxAttempts) {
      return refuse(409, 'attempt_limit', 'You have used all attempts for this quiz.');
    }
    const attemptId = new ObjectId();
    const filter = { _id: id, openAttemptId: null };
    if (settings.maxAttempts) filter.$or = [{ count: { $lt: settings.maxAttempts } }, { count: { $exists: false } }];
    let reserved;
    try {
      reserved = await counters.findOneAndUpdate(
        filter,
        { $inc: { count: 1 }, $set: { openAttemptId: String(attemptId), userId: ctx.member.userId, lessonId: ctx.lessonId, updatedAt: now } },
        { upsert: true, returnDocument: 'after', includeResultMetadata: false }
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      continue; // Another request changed the counter first: look again.
    }
    if (!reserved || reserved.openAttemptId !== String(attemptId)) continue;
    const attempt = newAttemptDocument(ctx, { _id: attemptId, number: reserved.count, now, random });
    try {
      await attempts.insertOne(attempt);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // A concurrent request saw the reservation before this insert and wrote the attempt first
      // (recreateReservedAttempt): same id, same number. That stored attempt is the attempt.
      const stored = await attempts.findOne({ _id: attemptId, userId: ctx.member.userId });
      if (stored) return { ok: true, attempt: stored, resumed: true };
      continue;
    }
    return { ok: true, attempt, resumed: false };
  }
  return refuse(409, 'attempt_busy', 'Another attempt is being started. Try again.');
}

function newAttemptDocument(ctx, { _id, number, now, random }) {
  const settings = quizSettings(ctx.quiz);
  return {
    _id,
    userId: ctx.member.userId,
    lessonId: ctx.lessonId,
    courseId: ctx.courseId,
    quizId: String(ctx.quiz._id),
    quizVersion: Number.isInteger(ctx.quiz.version) ? ctx.quiz.version : 0,
    number,
    status: 'in_progress',
    startedAt: now,
    deadlineAt: attemptDeadline(now, settings),
    passingPercent: settings.passingPercent,
    questions: buildAttemptQuestions(ctx.quiz, { random }),
    answers: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** A number was reserved but the attempt was never written (the request failed in between). */
async function recreateReservedAttempt(db, ctx, counter, now, random) {
  if (!ctx.quiz || !quizAvailability(ctx.quiz, now).ok) {
    await db.collection(COLLECTIONS.counters).updateOne({ _id: counter._id, openAttemptId: counter.openAttemptId }, { $set: { openAttemptId: null, count: Math.max(0, counter.count - 1), updatedAt: now } });
    return null;
  }
  const attempt = newAttemptDocument(ctx, { _id: new ObjectId(counter.openAttemptId), number: counter.count, now, random });
  try {
    await db.collection(COLLECTIONS.attempts).insertOne(attempt);
    return attempt;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    return db.collection(COLLECTIONS.attempts).findOne({ _id: attempt._id });
  }
}

/** Validated answers ({ questionId: optionIndex }) for the questions of this attempt only. */
function checkAnswers(attempt, input) {
  if (input === undefined || input === null) return { ok: true, answers: {} };
  if (typeof input !== 'object' || Array.isArray(input)) return refuse(400, 'invalid_answers', 'Answers are not valid.');
  const byId = new Map(attempt.questions.map((q) => [q.id, q]));
  const answers = {};
  for (const [questionId, value] of Object.entries(input)) {
    const question = byId.get(questionId);
    if (!question) return refuse(400, 'unknown_question', 'An answer names a question that is not in this attempt.');
    if (value === null) continue;
    if (!Number.isInteger(value) || value < 0 || value >= question.options.length) return refuse(400, 'invalid_answer', 'An answer is not one of the options.');
    answers[questionId] = value;
  }
  return { ok: true, answers };
}

/** Saves one answer (autosave). Only while the attempt is open, only for its own questions. */
async function saveAnswer(db, ctx, attemptId, body, { now = new Date() } = {}) {
  let attempt = await loadOwnAttempt(db, ctx, attemptId);
  if (!attempt) return refuse(404, 'attempt_not_found', 'Attempt not found');
  attempt = await settleExpired(db, attempt, now);
  if (attempt.status !== 'in_progress') {
    await reconcileAttempt(db, attempt, now);
    return refuse(409, 'attempt_closed', attempt.status === 'expired' ? 'Time is up for this attempt.' : 'This attempt has been submitted.');
  }
  const questionId = body && typeof body.questionId === 'string' ? body.questionId : '';
  const checked = checkAnswers(attempt, { [questionId]: body ? body.answer : undefined });
  if (!checked.ok) return checked;
  const filter = { _id: attempt._id, status: 'in_progress' };
  if (attempt.deadlineAt) filter.deadlineAt = { $gt: new Date(now.getTime() - SUBMIT_GRACE_SECONDS * 1000) };
  const update = Object.prototype.hasOwnProperty.call(checked.answers, questionId)
    ? { $set: { [`answers.${questionId}`]: checked.answers[questionId], updatedAt: now } }
    : { $unset: { [`answers.${questionId}`]: '' }, $set: { updatedAt: now } };
  const saved = await db.collection(COLLECTIONS.attempts).updateOne(filter, update);
  if (!saved.matchedCount) return refuse(409, 'attempt_closed', 'This attempt is closed.');
  return { ok: true, attempt: await db.collection(COLLECTIONS.attempts).findOne({ _id: attempt._id }) };
}

/**
 * Final submission. Idempotent: a repeated or concurrent submit returns the stored result, and
 * finishes any effects an interrupted one left. Once the attempt is overdue it expires and is
 * graded on the answers saved in time; answers sent with a late submit are ignored.
 */
async function submitAttempt(db, ctx, attemptId, body, { now = new Date() } = {}) {
  const attempt = await loadOwnAttempt(db, ctx, attemptId);
  if (!attempt) return refuse(404, 'attempt_not_found', 'Attempt not found');
  if (attempt.status !== 'in_progress') {
    return { ok: true, attempt: await reconcileAttempt(db, attempt, now), alreadyFinal: true };
  }
  if (attemptOverdue(attempt, now)) {
    return { ok: true, attempt: await settleExpired(db, attempt, now), expired: true };
  }
  const checked = checkAnswers(attempt, body && body.answers);
  if (!checked.ok) return checked;
  const answers = { ...(attempt.answers || {}), ...checked.answers };
  const settled = await finalizeAttempt(db, attempt, { status: 'submitted', answers, now });
  return { ok: true, attempt: settled };
}

/** The student's attempt, settled if its time ran out and reconciled if it was interrupted. */
async function readAttempt(db, ctx, attemptId, { now = new Date() } = {}) {
  const attempt = await loadOwnAttempt(db, ctx, attemptId);
  if (!attempt) return refuse(404, 'attempt_not_found', 'Attempt not found');
  return { ok: true, attempt: await reconcileAttempt(db, await settleExpired(db, attempt, now), now) };
}

/** Whether the answer key of `attempt` may be shown, given all of the student's attempts. */
async function reviewFor(db, ctx, attempt) {
  const all = await ownAttempts(db, ctx);
  return reviewAllowed(attempt, all, quizSettings(ctx.quiz));
}

/** The student's history on this quiz and what they may still do. */
async function attemptOverview(db, ctx, { now = new Date() } = {}) {
  const settings = quizSettings(ctx.quiz);
  await reconcileOwnAttempts(db, ctx, now);
  let list = await ownAttempts(db, ctx);
  const open = list.find((a) => a.status === 'in_progress');
  if (open && attemptOverdue(open, now)) {
    const full = await db.collection(COLLECTIONS.attempts).findOne({ _id: open._id });
    await settleExpired(db, full, now);
    list = await ownAttempts(db, ctx);
  }
  const used = list.length;
  const availability = quizAvailability(ctx.quiz, now);
  const inProgress = list.find((a) => a.status === 'in_progress') || null;
  return {
    attemptsUsed: used,
    attemptsRemaining: settings.maxAttempts ? Math.max(0, settings.maxAttempts - used) : null,
    canStart: Boolean(inProgress) || (availability.ok && (!settings.maxAttempts || used < settings.maxAttempts)),
    unavailableReason: availability.ok ? null : availability.code,
    inProgressAttemptId: inProgress ? String(inProgress._id) : null,
    attempts: list.map((a) => ({
      id: String(a._id),
      number: a.number,
      status: a.status,
      startedAt: new Date(a.startedAt).toISOString(),
      submittedAt: a.submittedAt ? new Date(a.submittedAt).toISOString() : null,
      result: FINISHED_STATUSES.includes(a.status) && a.result
        ? { percent: a.result.percent, earned: a.result.earned, available: a.result.available, passed: a.result.passed }
        : null,
      reviewAvailable: reviewAllowed(a, list, settings),
    })),
  };
}

function pageOf({ page, limit } = {}) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isInteger(limit) ? limit : RESULTS_PAGE_SIZE));
  const number = Math.max(1, Number.isInteger(page) ? page : 1);
  return { page: number, limit: size, skip: (number - 1) * size };
}

/** Attempts whose time ran out while nobody was looking: settled so results are complete. */
async function settleOverdueForLesson(db, lessonId, now) {
  const rows = await db.collection(COLLECTIONS.attempts)
    .find({ lessonId, status: 'in_progress', deadlineAt: { $ne: null, $lte: new Date(now.getTime() - SUBMIT_GRACE_SECONDS * 1000) } })
    .limit(RESULTS_SETTLE_LIMIT)
    .toArray();
  for (const row of rows) await settleExpired(db, row, now);
}

/**
 * Results of one quiz for the course instructor or an admin: finished attempts, newest first, one
 * page at a time, with student names in one batched query. The summary covers every finished
 * attempt, not just this page. Answers and answer keys are left out; one attempt is opened with
 * attemptForStaff.
 */
async function quizResults(db, ctx, options = {}) {
  const now = options.now || new Date();
  const { page, limit, skip } = pageOf(options);
  await settleOverdueForLesson(db, ctx.lessonId, now);
  const attempts = db.collection(COLLECTIONS.attempts);
  const finishedFilter = { lessonId: ctx.lessonId, status: { $in: FINISHED_STATUSES.slice() } };
  const [rows, totals] = await Promise.all([
    attempts
      .find(finishedFilter, { projection: { questions: 0, answers: 0 } })
      .sort({ submittedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    attempts.aggregate([
      { $match: finishedFilter },
      {
        $group: {
          _id: null,
          attempts: { $sum: 1 },
          students: { $addToSet: '$userId' },
          averagePercent: { $avg: '$result.percent' },
          passed: { $sum: { $cond: [{ $eq: ['$result.passed', true] }, 1, 0] } },
        },
      },
      { $project: { attempts: 1, students: { $size: '$students' }, averagePercent: 1, passed: 1 } },
    ]).toArray(),
  ]);
  const ids = [...new Set(rows.map((r) => r.userId))].filter(isStoredId).map((v) => new ObjectId(v));
  const users = ids.length ? await db.collection('users').find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray() : [];
  const names = new Map(users.map((u) => [String(u._id), u.name || 'Student']));
  const total = totals[0] || { attempts: 0, students: 0, averagePercent: null, passed: 0 };
  return {
    attempts: rows.map((r) => ({
      attemptId: String(r._id),
      userId: r.userId,
      studentName: names.get(r.userId) || 'Student',
      number: r.number,
      status: r.status,
      submittedAt: r.submittedAt ? new Date(r.submittedAt).toISOString() : null,
      percent: r.result ? r.result.percent : null,
      passed: r.result ? r.result.passed : null,
    })),
    summary: {
      attempts: total.attempts,
      students: total.students,
      averagePercent: typeof total.averagePercent === 'number' ? Math.round(total.averagePercent * 100) / 100 : null,
      passed: total.passed,
    },
    pagination: { page, limit, total: total.attempts, pages: Math.ceil(total.attempts / limit) },
  };
}

/** One finished attempt of this lesson's quiz, for the staff `ctx` already authorized. */
async function attemptForStaff(db, ctx, attemptId) {
  if (!isStoredId(attemptId)) return refuse(404, 'attempt_not_found', 'Attempt not found');
  const attempt = await db.collection(COLLECTIONS.attempts).findOne({
    _id: new ObjectId(attemptId),
    lessonId: ctx.lessonId,
    status: { $in: FINISHED_STATUSES.slice() },
  });
  if (!attempt) return refuse(404, 'attempt_not_found', 'Attempt not found');
  return { ok: true, attempt };
}

/**
 * A student's results across all quizzes, newest first. Reads quizScores, so results from before
 * Phase 9 are included. Only what a result summary needs: never questions, answers or keys.
 */
async function assessmentHistory(db, { userId, page, limit }) {
  const paging = pageOf({ page, limit });
  const scores = db.collection(COLLECTIONS.scores);
  const [rows, total] = await Promise.all([
    scores
      .find({ userId }, { projection: { answers: 0 } })
      .sort({ createdAt: -1, _id: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .toArray(),
    scores.countDocuments({ userId }),
  ]);
  const idsOf = (field) => [...new Set(rows.map((r) => String(r[field])))].filter(isStoredId).map((v) => new ObjectId(v));
  const lessonIds = idsOf('lessonId');
  const courseIds = idsOf('courseId');
  const [lessons, courses] = await Promise.all([
    lessonIds.length ? db.collection('lessons').find({ _id: { $in: lessonIds } }, { projection: { title: 1 } }).toArray() : [],
    courseIds.length ? db.collection('courses').find({ _id: { $in: courseIds } }, { projection: { title: 1 } }).toArray() : [],
  ]);
  const lessonTitles = new Map(lessons.map((l) => [String(l._id), l.title || 'Lesson']));
  const courseTitles = new Map(courses.map((c) => [String(c._id), c.title || 'Course']));
  return {
    results: rows.map((r) => ({
      id: String(r._id),
      lessonId: String(r.lessonId),
      courseId: String(r.courseId),
      lessonTitle: lessonTitles.get(String(r.lessonId)) || null,
      courseTitle: courseTitles.get(String(r.courseId)) || null,
      attemptNumber: typeof r.attemptNumber === 'number' ? r.attemptNumber : null,
      percent: typeof r.percentage === 'number' ? r.percentage : typeof r.score === 'number' ? r.score : 0,
      passed: typeof r.passed === 'boolean' ? r.passed : null,
      status: typeof r.status === 'string' ? r.status : 'submitted',
      correct: typeof r.correct === 'number' ? r.correct : null,
      total: typeof r.totalQuestions === 'number' ? r.totalQuestions : null,
      finishedAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    })),
    pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) },
  };
}

/**
 * The lesson of these attempts is being deleted. Finished attempts and scores stay: they are
 * student records and complete in themselves (frozen questions). Attempts in progress can no longer
 * be reached, so they are cancelled, with no result and no score, and the counters go.
 */
async function closeLessonAttempts(db, lessonId, { now = new Date() } = {}) {
  const cancelled = await db.collection(COLLECTIONS.attempts).updateMany(
    { lessonId: String(lessonId), status: 'in_progress' },
    { $set: { status: 'cancelled', cancelReason: 'lesson_deleted', finalizedAt: now, updatedAt: now } }
  );
  await db.collection(COLLECTIONS.counters).deleteMany({ lessonId: String(lessonId) });
  return { cancelled: cancelled.modifiedCount };
}

/**
 * Operator sweep (scripts/quiz-attempt-reconcile.js): attempts interrupted before their effects
 * finished, and attempts that ran out of time with no later request. Read-only unless `apply`.
 */
async function sweepAttempts(db, { apply = false, now = new Date(), limit = 500 } = {}) {
  const attempts = db.collection(COLLECTIONS.attempts);
  const overdueFilter = { status: 'in_progress', deadlineAt: { $ne: null, $lte: new Date(now.getTime() - SUBMIT_GRACE_SECONDS * 1000) } };
  const pendingFilter = { effectsPending: true };
  const found = { pending: await attempts.countDocuments(pendingFilter), overdue: await attempts.countDocuments(overdueFilter) };
  if (!apply) return { ...found, reconciled: 0, expired: 0, failed: 0 };
  let reconciled = 0;
  let expired = 0;
  let failed = 0;
  for (const row of await attempts.find(pendingFilter, { projection: { questions: 0 } }).limit(limit).toArray()) {
    try {
      await reconcileAttempt(db, row, now);
      reconciled += 1;
    } catch {
      failed += 1; // Still flagged: the next sweep or the student's next request retries it.
    }
  }
  for (const row of await attempts.find(overdueFilter).limit(limit).toArray()) {
    try {
      await settleExpired(db, row, now);
      expired += 1;
    } catch {
      failed += 1;
    }
  }
  return { ...found, reconciled, expired, failed };
}

module.exports = {
  COLLECTIONS,
  assessmentHistory,
  attemptForStaff,
  attemptOverview,
  checkAnswers,
  closeLessonAttempts,
  counterId,
  finalizeAttempt,
  loadQuizContext,
  quizResults,
  readAttempt,
  reconcileAttempt,
  reviewFor,
  saveAnswer,
  startAttempt,
  submitAttempt,
  sweepAttempts,
};
