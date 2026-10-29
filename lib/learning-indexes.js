'use strict';

/**
 * Read-path indexes for the learning collections (docs/audits/performance-audit-2026-10-29.md).
 *
 * None of these collections had an index besides _id, so the queries below scanned the whole
 * collection on every request. All are non-unique: building them cannot fail on existing data
 * and they never reject a write. `progress` deliberately has no { userId, courseId } index here,
 * because that key is reserved for the planned unique enrollment index.
 */
const LEARNING_INDEXES = Object.freeze([
  {
    id: 'L1',
    collection: 'progress',
    key: { userId: 1 },
    options: { name: 'perf_progress_user' },
    serves: 'GET /api/progress, the enrollment overlay in GET /api/courses, course and lesson access checks',
  },
  {
    id: 'L2',
    collection: 'lessons',
    key: { courseId: 1, order: 1 },
    options: { name: 'perf_lessons_course_order' },
    serves: 'course detail and lesson lists (find by courseId sorted by order), lesson counts in GET /api/progress',
  },
  {
    id: 'L3',
    collection: 'quizScores',
    key: { userId: 1, courseId: 1 },
    options: { name: 'perf_quizscores_user_course' },
    serves: 'quiz history in GET /api/progress',
  },
  {
    id: 'L4',
    collection: 'notifications',
    key: { userId: 1, createdAt: -1 },
    options: { name: 'perf_notifications_user_recent' },
    serves: 'GET /api/notifications (header, every signed-in page): newest 50 for one user',
  },
  {
    id: 'L5',
    collection: 'demoTradeJournal',
    key: { studentId: 1, createdAt: -1 },
    options: { name: 'perf_journal_student_recent' },
    serves: 'GET /api/demo-trading/journal (practice desk)',
  },
  {
    id: 'L6',
    collection: 'progress',
    key: { courseId: 1, progress: -1 },
    options: { name: 'perf_progress_course_rank' },
    serves: 'course leaderboard and staff progress by course',
  },
  {
    id: 'L7',
    collection: 'users',
    key: { role: 1, points: -1 },
    options: { name: 'perf_users_role_points' },
    serves: 'GET /api/leaderboard (students by points)',
  },
]);

module.exports = { LEARNING_INDEXES };
