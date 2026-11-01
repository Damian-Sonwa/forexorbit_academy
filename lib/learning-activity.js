'use strict';

/**
 * Learning activity: active minutes, learning days, streaks and the last-viewed lesson (Phase 8).
 *
 * Rules (docs/audits/phase-8-learning-progress.md, section 4):
 *
 *   Active minute   A clock minute (server time, UTC) in which the server accepted at least one
 *                   activity signal from the student. The lesson page sends a signal only while it
 *                   is visible and the student interacted with it, or a video played, within the
 *                   last ACTIVE_WINDOW_SECONDS. One record per student per minute
 *                   (`learningMinutes._id = <userId>:<minute>`), so repeated requests, several tabs
 *                   and several devices in the same minute count once. Learning time can therefore
 *                   never exceed elapsed wall-clock time, and the server clock (never a client
 *                   timestamp) decides the minute, so time cannot be backdated or replayed.
 *   Learning time   The number of active minutes.
 *   Learning day    A calendar day in LEARNING_TIMEZONE with at least one active minute.
 *                   `learningDays._id = <userId>:<YYYY-MM-DD>` holds the day's minute count; it is
 *                   incremented only when a new minute record was created.
 *   Streak          Consecutive learning days ending today, or ending yesterday when today has no
 *                   activity yet (a streak is not lost until a whole day passes without learning).
 *                   Longest streak: the longest such run in the student's history.
 *   Last viewed     Opening a lesson ('view') sets `lastLessonId` and `lastViewedAt` on the
 *                   enrollment row, only when no newer view is stored (server time; newest wins).
 *                   Any signal also moves `lastActivityAt` forward (never back).
 *
 * Who may record: the same rule as lesson completion (decideProgressUpdate: the student's own
 * active enrollment in a course open to students, the lesson belonging to that course) plus the
 * Phase 6 paywall (the lesson must be open to them). The route derives everything from the
 * session and the stored lesson; nothing in the request body names a user or a course.
 */

const LEARNING_TIMEZONE = 'Africa/Lagos';
const ACTIVE_WINDOW_SECONDS = 60;
const HEARTBEAT_SECONDS = 30;
const MINUTE_RETENTION_DAYS = 90;
const ACTIVITY_EVENTS = Object.freeze(['view', 'heartbeat']);
const COLLECTIONS = Object.freeze({ minutes: 'learningMinutes', days: 'learningDays' });
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: LEARNING_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar day (YYYY-MM-DD) of `date` in the learning timezone. */
function dayKey(date) {
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** UTC minute of `date`, YYYY-MM-DDTHH:MM, and its start. */
function minuteOf(date) {
  const start = new Date(Math.floor(date.getTime() / 60000) * 60000);
  return { key: start.toISOString().slice(0, 16), start };
}

function shiftDay(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Current and longest streak from a student's learning days (any order, duplicates ignored).
 * `today` is today's day key in the learning timezone.
 */
function computeStreak(dayKeys, today) {
  const days = [...new Set((Array.isArray(dayKeys) ? dayKeys : []).filter((d) => typeof d === 'string' && DAY_PATTERN.test(d)))].sort();
  let longest = 0;
  let run = 0;
  let previous = null;
  for (const day of days) {
    run = previous && shiftDay(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  const set = new Set(days);
  const activeToday = set.has(today);
  let current = 0;
  let cursor = activeToday ? today : shiftDay(today, -1);
  while (set.has(cursor)) {
    current += 1;
    cursor = shiftDay(cursor, -1);
  }
  return { current, longest, activeToday };
}

function isDuplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));
}

/**
 * Records one accepted activity signal (the caller has authorized it). Returns
 * { newMinute, day, minute }. Idempotent within a minute.
 */
async function recordActivity(db, { userId, courseId, lessonId, event, now = new Date() }) {
  const user = String(userId);
  const course = String(courseId);
  const lesson = String(lessonId);
  const minute = minuteOf(now);
  const day = dayKey(now);
  let newMinute = false;
  try {
    const result = await db.collection(COLLECTIONS.minutes).updateOne(
      { _id: `${user}:${minute.key}` },
      { $setOnInsert: { userId: user, courseId: course, lessonId: lesson, day, at: minute.start } },
      { upsert: true }
    );
    newMinute = Boolean(result && (result.upsertedCount === 1 || result.upsertedId));
  } catch (error) {
    // Two signals in the same minute raced: the other one created the record.
    if (!isDuplicateKey(error)) throw error;
  }
  if (newMinute) {
    await db.collection(COLLECTIONS.days).updateOne(
      { _id: `${user}:${day}` },
      { $inc: { minutes: 1 }, $setOnInsert: { userId: user, day }, $max: { lastAt: now } },
      { upsert: true }
    );
  }
  const enrollment = db.collection('progress');
  const own = { userId: user, courseId: course };
  // Never moves back: a delayed request with an older server time cannot replace a newer one.
  await enrollment.updateOne(own, { $max: { lastActivityAt: now } });
  if (event === 'view') {
    await enrollment.updateOne(
      { ...own, $or: [{ lastViewedAt: { $exists: false } }, { lastViewedAt: { $lte: now } }] },
      { $set: { lastLessonId: lesson, lastViewedAt: now } }
    );
  }
  return { newMinute, day, minute: minute.key };
}

/**
 * Learning time and streak for one student. One query: their learning days (one small row per
 * day). `now` decides today in the learning timezone.
 */
async function learningStats(db, userId, { now = new Date(), recentDays = 7 } = {}) {
  const rows = await db.collection(COLLECTIONS.days)
    .find({ userId: String(userId) }, { projection: { day: 1, minutes: 1 } })
    .sort({ day: -1 })
    .limit(3660)
    .toArray();
  const today = dayKey(now);
  const byDay = new Map(rows.map((row) => [row.day, typeof row.minutes === 'number' ? row.minutes : 0]));
  const recent = [];
  for (let i = recentDays - 1; i >= 0; i -= 1) {
    const day = shiftDay(today, -i);
    recent.push({ day, minutes: byDay.get(day) || 0 });
  }
  const totalMinutes = rows.reduce((sum, row) => sum + (typeof row.minutes === 'number' ? row.minutes : 0), 0);
  return {
    timezone: LEARNING_TIMEZONE,
    today,
    todayMinutes: byDay.get(today) || 0,
    recentMinutes: recent.reduce((sum, d) => sum + d.minutes, 0),
    totalMinutes,
    recent,
    streak: computeStreak(rows.map((row) => row.day), today),
  };
}

module.exports = {
  ACTIVE_WINDOW_SECONDS,
  ACTIVITY_EVENTS,
  COLLECTIONS,
  HEARTBEAT_SECONDS,
  LEARNING_TIMEZONE,
  MINUTE_RETENTION_DAYS,
  computeStreak,
  dayKey,
  learningStats,
  minuteOf,
  recordActivity,
  shiftDay,
};
