'use strict';

/**
 * Lesson quiz rules (Phase 9): question validation, quiz settings, attempt snapshots, scoring and
 * the review policy. Pure functions with no dependencies, so they are shared by the API routes,
 * lib/quiz-attempts.js and the tests. Rules: docs/audits/phase-9-assessments.md, sections 6-10.
 *
 * Question types: single-answer multiple choice (2-8 options, one correct option; two options
 * cover true/false). Each question is all-or-nothing and carries a weight (`points`, whole
 * numbers 1-100, default 1). No partial credit (a product decision, see the report).
 */

const MAX_QUESTIONS = 100;
const MAX_QUESTION_LENGTH = 2000;
const MAX_OPTION_LENGTH = 500;
const MAX_EXPLANATION_LENGTH = 2000;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;
const MAX_POINTS = 100;
const MAX_ATTEMPTS_LIMIT = 20;
const MAX_TIME_LIMIT_MINUTES = 300;
/**
 * Approved policy: an attempt stays open this long after its deadline, for network delay. It is
 * the only timing rule: reads, autosaves and submits all use attemptOverdue, so nothing expires an
 * attempt while a final submit would still be accepted.
 */
const SUBMIT_GRACE_SECONDS = 10;
const REVIEW_POLICIES = Object.freeze(['after_submission', 'after_pass', 'after_last_attempt', 'never']);
const QUIZ_STATUSES = Object.freeze(['draft', 'published']);
const QUESTION_ID = /^[a-f0-9]{12}$/;
/** Attempts with a result. `cancelled` (the lesson was deleted mid-attempt) has none. */
const FINISHED_STATUSES = Object.freeze(['submitted', 'expired']);

/**
 * Settings of a quiz saved before Phase 9: they reproduce the behaviour students had (published,
 * unlimited attempts, no time limit, no pass mark, answers reviewable after submitting).
 */
const LEGACY_SETTINGS = Object.freeze({
  status: 'published',
  maxAttempts: null,
  timeLimitMinutes: null,
  passingPercent: null,
  reviewPolicy: 'after_submission',
  shuffleQuestions: false,
  shuffleOptions: false,
  availableFrom: null,
  availableUntil: null,
});

function invalid(field, error) {
  return { ok: false, status: 400, code: 'invalid_quiz', field, error };
}

function randomId(random) {
  let id = '';
  for (let i = 0; i < 12; i += 1) id += Math.floor(random() * 16).toString(16);
  return id;
}

/**
 * Validated questions to store. Existing ids are kept (so edits keep identity); new questions get
 * an id. `random` is injectable for tests. Returns { ok, questions } or { ok: false, ... }.
 */
function normalizeQuestions(input, { random = Math.random } = {}) {
  if (!Array.isArray(input) || input.length === 0) return invalid('questions', 'Add at least one question.');
  if (input.length > MAX_QUESTIONS) return invalid('questions', `A quiz can have at most ${MAX_QUESTIONS} questions.`);
  const ids = new Set();
  const questions = [];
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    const at = `questions[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid(at, `Question ${index + 1} is not valid.`);
    const text = typeof item.question === 'string' ? item.question.trim() : '';
    if (!text || text.length > MAX_QUESTION_LENGTH) return invalid(`${at}.question`, `Question ${index + 1} needs text (at most ${MAX_QUESTION_LENGTH} characters).`);
    if (!Array.isArray(item.options) || item.options.length < MIN_OPTIONS || item.options.length > MAX_OPTIONS) {
      return invalid(`${at}.options`, `Question ${index + 1} needs ${MIN_OPTIONS}-${MAX_OPTIONS} options.`);
    }
    const options = [];
    const seen = new Set();
    for (const option of item.options) {
      const value = typeof option === 'string' ? option.trim() : '';
      if (!value || value.length > MAX_OPTION_LENGTH) return invalid(`${at}.options`, `Question ${index + 1} has an empty or too long option.`);
      const key = value.toLowerCase();
      if (seen.has(key)) return invalid(`${at}.options`, `Question ${index + 1} has the same option twice.`);
      seen.add(key);
      options.push(value);
    }
    if (!Number.isInteger(item.correctAnswer) || item.correctAnswer < 0 || item.correctAnswer >= options.length) {
      return invalid(`${at}.correctAnswer`, `Question ${index + 1} needs exactly one correct option.`);
    }
    let points = 1;
    if (item.points !== undefined && item.points !== null) {
      if (!Number.isInteger(item.points) || item.points < 1 || item.points > MAX_POINTS) return invalid(`${at}.points`, `Question ${index + 1}: points must be a whole number from 1 to ${MAX_POINTS}.`);
      points = item.points;
    }
    let explanation = '';
    if (item.explanation !== undefined && item.explanation !== null) {
      if (typeof item.explanation !== 'string' || item.explanation.length > MAX_EXPLANATION_LENGTH) return invalid(`${at}.explanation`, `Question ${index + 1}: the explanation is too long.`);
      explanation = item.explanation.trim();
    }
    let id = typeof item.id === 'string' && QUESTION_ID.test(item.id) && !ids.has(item.id) ? item.id : '';
    while (!id || ids.has(id)) id = randomId(random);
    ids.add(id);
    questions.push({ id, question: text, options, correctAnswer: item.correctAnswer, points, explanation });
  }
  return { ok: true, questions };
}

function optionalDate(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, value: date };
}

/** Settings to store, merged over `current` (stored settings or the legacy defaults). */
function normalizeSettings(input, current = LEGACY_SETTINGS) {
  const base = { ...LEGACY_SETTINGS, ...(current || {}) };
  if (input === undefined || input === null) return { ok: true, settings: base };
  if (typeof input !== 'object' || Array.isArray(input)) return invalid('settings', 'Settings are not valid.');
  const next = { ...base };
  if ('status' in input) {
    if (!QUIZ_STATUSES.includes(input.status)) return invalid('settings.status', 'Status must be draft or published.');
    next.status = input.status;
  }
  if ('maxAttempts' in input) {
    const v = input.maxAttempts;
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= MAX_ATTEMPTS_LIMIT)) return invalid('settings.maxAttempts', `Attempts must be 1-${MAX_ATTEMPTS_LIMIT}, or unlimited.`);
    next.maxAttempts = v;
  }
  if ('timeLimitMinutes' in input) {
    const v = input.timeLimitMinutes;
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= MAX_TIME_LIMIT_MINUTES)) return invalid('settings.timeLimitMinutes', `The time limit must be 1-${MAX_TIME_LIMIT_MINUTES} minutes, or none.`);
    next.timeLimitMinutes = v;
  }
  if ('passingPercent' in input) {
    const v = input.passingPercent;
    if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 100)) return invalid('settings.passingPercent', 'The pass mark must be a whole percentage 0-100, or none.');
    next.passingPercent = v;
  }
  if ('reviewPolicy' in input) {
    if (!REVIEW_POLICIES.includes(input.reviewPolicy)) return invalid('settings.reviewPolicy', 'Unknown review policy.');
    next.reviewPolicy = input.reviewPolicy;
  }
  for (const key of ['shuffleQuestions', 'shuffleOptions']) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') return invalid(`settings.${key}`, `${key} must be true or false.`);
      next[key] = input[key];
    }
  }
  for (const key of ['availableFrom', 'availableUntil']) {
    if (key in input) {
      const parsed = optionalDate(input[key]);
      if (!parsed.ok) return invalid(`settings.${key}`, `${key} is not a valid date.`);
      next[key] = parsed.value;
    }
  }
  if (next.availableFrom && next.availableUntil && next.availableFrom >= next.availableUntil) {
    return invalid('settings.availableUntil', 'The quiz must close after it opens.');
  }
  return { ok: true, settings: next };
}

/**
 * Publication state of a quiz saved before Phase 9. There was no such state then, so quizzes without
 * one stay visible as they were; a stored marker (`status` or `published`) that says otherwise is
 * kept, so this code never publishes a quiz that was not published.
 */
function legacyStatus(quiz) {
  if (!quiz) return LEGACY_SETTINGS.status;
  if (quiz.published === false) return 'draft';
  if (typeof quiz.status === 'string' && quiz.status !== 'published') return 'draft';
  return LEGACY_SETTINGS.status;
}

/** Settings of a stored quiz (legacy quizzes have none). */
function quizSettings(quiz) {
  return { ...LEGACY_SETTINGS, status: legacyStatus(quiz), ...((quiz && quiz.settings) || {}) };
}

/** Whether students may start an attempt now: published, inside the window, has questions. */
function quizAvailability(quiz, now = new Date()) {
  const settings = quizSettings(quiz);
  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) return { ok: false, status: 404, code: 'quiz_not_found', error: 'Quiz not found' };
  if (settings.status !== 'published') return { ok: false, status: 404, code: 'quiz_not_found', error: 'Quiz not found' };
  if (settings.availableFrom && now < new Date(settings.availableFrom)) return { ok: false, status: 403, code: 'quiz_not_open', error: 'This quiz is not open yet.' };
  if (settings.availableUntil && now >= new Date(settings.availableUntil)) return { ok: false, status: 403, code: 'quiz_closed', error: 'This quiz has closed.' };
  return { ok: true, settings };
}

function shuffled(list, random) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * The questions of a new attempt, frozen: text, options in the order this student sees them, the
 * correct option in that order, points and explanation. Later edits of the quiz never change an
 * attempt. Shuffling happens once, here, on the server.
 */
function buildAttemptQuestions(quiz, { random = Math.random } = {}) {
  const settings = quizSettings(quiz);
  const source = (quiz.questions || []).map((q, index) => ({ ...q, id: typeof q.id === 'string' && q.id ? q.id : `legacy${index}` }));
  const ordered = settings.shuffleQuestions ? shuffled(source, random) : source;
  return ordered.map((q) => {
    const indexes = q.options.map((_, i) => i);
    const order = settings.shuffleOptions ? shuffled(indexes, random) : indexes;
    return {
      id: q.id,
      question: q.question,
      options: order.map((i) => q.options[i]),
      correct: order.indexOf(q.correctAnswer),
      points: Number.isInteger(q.points) && q.points > 0 ? q.points : 1,
      explanation: typeof q.explanation === 'string' ? q.explanation : '',
    };
  });
}

/** Deadline of an attempt: start + time limit, never after the quiz closes. Null when untimed. */
function attemptDeadline(startedAt, settings) {
  const limits = [];
  if (settings.timeLimitMinutes) limits.push(new Date(startedAt).getTime() + settings.timeLimitMinutes * 60000);
  if (settings.availableUntil) limits.push(new Date(settings.availableUntil).getTime());
  return limits.length ? new Date(Math.min(...limits)) : null;
}

/** Whether an attempt's time, including the grace period, is over. Untimed attempts never are. */
function attemptOverdue(attempt, now = new Date()) {
  if (!attempt || !attempt.deadlineAt) return false;
  return new Date(now).getTime() >= new Date(attempt.deadlineAt).getTime() + SUBMIT_GRACE_SECONDS * 1000;
}

/**
 * Whether a finished attempt completes its lesson. Approved policy: a failed attempt does not, and
 * neither does an attempt with no answers, submitted or timed out, even when the quiz has no pass
 * mark (or a pass mark of 0). With no pass mark, any attempt with at least one answer does.
 */
function attemptCompletesLesson(attempt) {
  const result = attempt && attempt.result;
  if (!result || result.passed === false) return false;
  return result.answeredCount > 0;
}

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Score of an attempt from its frozen questions and saved answers ({ [questionId]: optionIndex }).
 * Unanswered or invalid answers score 0. Earned marks never exceed available marks. The
 * percentage is rounded to 2 decimals (half away from zero for these non-negative values).
 */
function scoreAttempt(questions, answers, passingPercent) {
  const saved = answers && typeof answers === 'object' ? answers : {};
  let earned = 0;
  let available = 0;
  let correctCount = 0;
  let answeredCount = 0;
  const perQuestion = questions.map((q) => {
    available += q.points;
    const answer = Object.prototype.hasOwnProperty.call(saved, q.id) ? saved[q.id] : null;
    const answered = Number.isInteger(answer) && answer >= 0 && answer < q.options.length;
    const correct = answered && answer === q.correct;
    if (answered) answeredCount += 1;
    if (correct) {
      earned += q.points;
      correctCount += 1;
    }
    return { id: q.id, answered, correct, earned: correct ? q.points : 0 };
  });
  earned = Math.min(earned, available);
  const percent = available > 0 ? round2((earned / available) * 100) : 0;
  return {
    earned,
    available,
    percent,
    correctCount,
    answeredCount,
    total: questions.length,
    passed: passingPercent === null || passingPercent === undefined ? null : percent >= passingPercent,
    perQuestion,
  };
}

/**
 * Whether this attempt's answer key and explanations may be shown, under the quiz's review
 * policy. `attempts` are the student's attempts on this quiz, `settings` the current settings.
 */
function reviewAllowed(attempt, attempts, settings) {
  if (!attempt || !FINISHED_STATUSES.includes(attempt.status)) return false;
  switch (settings.reviewPolicy) {
    case 'after_submission':
      return true;
    case 'after_pass':
      if (settings.passingPercent === null) return true;
      return (attempts || []).some((a) => a.status !== 'in_progress' && a.result && a.result.passed === true);
    case 'after_last_attempt':
      return Boolean(settings.maxAttempts) && (attempts || []).filter((a) => a.status !== 'in_progress').length >= settings.maxAttempts;
    default:
      return false;
  }
}

/**
 * The student's view of an attempt. Never contains the answer key unless `review` is true; never
 * contains another student's data (the caller loads only the session's own attempts).
 */
function presentAttempt(attempt, { now = new Date(), review = false } = {}) {
  const view = {
    id: String(attempt._id),
    number: attempt.number,
    status: attempt.status,
    startedAt: new Date(attempt.startedAt).toISOString(),
    deadlineAt: attempt.deadlineAt ? new Date(attempt.deadlineAt).toISOString() : null,
    serverNow: now.toISOString(),
    submittedAt: attempt.submittedAt ? new Date(attempt.submittedAt).toISOString() : null,
    questions: attempt.questions.map((q) => ({ id: q.id, question: q.question, options: q.options.slice(), points: q.points })),
    answers: { ...(attempt.answers || {}) },
  };
  if (attempt.status !== 'in_progress' && attempt.result) {
    const r = attempt.result;
    view.result = { earned: r.earned, available: r.available, percent: r.percent, passed: r.passed, correctCount: r.correctCount, answeredCount: r.answeredCount, total: r.total };
    view.reviewAvailable = Boolean(review);
    if (review) {
      const byId = new Map((r.perQuestion || []).map((p) => [p.id, p]));
      view.review = attempt.questions.map((q) => ({
        id: q.id,
        correctAnswer: q.correct,
        correct: Boolean(byId.get(q.id) && byId.get(q.id).correct),
        explanation: q.explanation || '',
      }));
    }
  }
  return view;
}

/**
 * One finished attempt for the course instructor or an admin: the student's answers against the
 * questions and key frozen at the start, so it stays accurate after the quiz is edited.
 */
function presentAttemptForStaff(attempt) {
  const r = attempt.result || {};
  const byId = new Map((r.perQuestion || []).map((p) => [p.id, p]));
  const answers = attempt.answers || {};
  return {
    id: String(attempt._id),
    number: attempt.number,
    status: attempt.status,
    startedAt: new Date(attempt.startedAt).toISOString(),
    submittedAt: attempt.submittedAt ? new Date(attempt.submittedAt).toISOString() : null,
    result: attempt.result ? { earned: r.earned, available: r.available, percent: r.percent, passed: r.passed, correctCount: r.correctCount, total: r.total } : null,
    questions: attempt.questions.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options.slice(),
      points: q.points,
      correctAnswer: q.correct,
      answer: Object.prototype.hasOwnProperty.call(answers, q.id) ? answers[q.id] : null,
      correct: Boolean(byId.get(q.id) && byId.get(q.id).correct),
    })),
  };
}

/** What a student may know about a quiz before starting: never the questions or answers. */
function presentQuizSummary(quiz) {
  const s = quizSettings(quiz);
  const questions = Array.isArray(quiz && quiz.questions) ? quiz.questions : [];
  return {
    questionCount: questions.length,
    totalPoints: questions.reduce((sum, q) => sum + (Number.isInteger(q.points) && q.points > 0 ? q.points : 1), 0),
    maxAttempts: s.maxAttempts,
    timeLimitMinutes: s.timeLimitMinutes,
    passingPercent: s.passingPercent,
    reviewPolicy: s.reviewPolicy,
    availableFrom: s.availableFrom ? new Date(s.availableFrom).toISOString() : null,
    availableUntil: s.availableUntil ? new Date(s.availableUntil).toISOString() : null,
  };
}

/** Authoring view (course instructor, admins): everything, including the answer key. */
function presentQuizForStaff(quiz) {
  const s = quizSettings(quiz);
  return {
    questions: (quiz.questions || []).map((q, index) => ({
      id: typeof q.id === 'string' ? q.id : `legacy${index}`,
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer,
      points: Number.isInteger(q.points) ? q.points : 1,
      explanation: typeof q.explanation === 'string' ? q.explanation : '',
    })),
    settings: {
      ...s,
      availableFrom: s.availableFrom ? new Date(s.availableFrom).toISOString() : null,
      availableUntil: s.availableUntil ? new Date(s.availableUntil).toISOString() : null,
    },
    version: Number.isInteger(quiz.version) ? quiz.version : 0,
  };
}

module.exports = {
  LEGACY_SETTINGS,
  MAX_ATTEMPTS_LIMIT,
  MAX_QUESTIONS,
  MAX_TIME_LIMIT_MINUTES,
  REVIEW_POLICIES,
  FINISHED_STATUSES,
  SUBMIT_GRACE_SECONDS,
  attemptCompletesLesson,
  attemptDeadline,
  attemptOverdue,
  buildAttemptQuestions,
  normalizeQuestions,
  normalizeSettings,
  presentAttempt,
  presentAttemptForStaff,
  presentQuizForStaff,
  presentQuizSummary,
  quizAvailability,
  quizSettings,
  reviewAllowed,
  scoreAttempt,
};
