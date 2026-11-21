# Phase 11: Student dashboards and analytics

Branch `feat/phase-11-student-analytics`, from `cae4a29` (origin/master). Not committed.

## 1. Audit inventory

| Need | Existing (reused) | Gap (built) |
|---|---|---|
| Courses, status, percent, continue learning | `lib/progress-summary.js` (Phase 8): active enrollments, visibility, lock rule, resume target | Optional `withLessons` (each lesson and whether it is open), with no extra queries |
| Lesson completion | `lib/course-progress.js` `recordLessonCompletion` (ids only) | **No timestamps existed.** Added `lessonCompletedAt.<lessonId>`, set once and conditionally |
| Learning time / streak | `learningDays` (Phase 8, Africa/Lagos days) | Range series (7/30/90/all) |
| Quiz results | `quizScores` (Phase 9, one row per finished attempt), `quizAttempts`, `quizSettings`/`quizAvailability` | Aggregates, trend, upcoming quizzes with eligibility |
| Assignments | `assignments`, `assignmentSubmissions`, Phase 6 course-level rule | Upcoming / overdue list |
| Certificates | `certificates` | Used for activity and milestones |
| Badges | `badges`/`userBadges` (admin-assigned) | Not merged with milestones (milestones are derived on read, so they never conflict). **Bug fixed:** a student could read another student's badges via `?userId=` |
| Notifications | `GET/PUT /api/notifications` (per-user copies, read state) | Reused as is on the dashboard; no new notification system, nothing sent on open |
| Trading | `lib/trading/views.js` (`performanceOf`, `accountView`), money and instrument helpers | Read-only analytics: averages, by instrument, by day, recent trades |
| Tenancy | None in the app (single tenant) | Isolation is per student, from the session |

## 2. Endpoints (students only, GET, private no-store, rate limited `student-dashboard-read` 300/10 min)

- `GET /api/student/dashboard?range=` returns everything in one response, shared by all sections.
- `GET /api/student/analytics/learning?range=7|30|90|all` returns the learning series.
- `GET /api/student/analytics/activity?page=&limit=` returns activity, at most 20 per page, over the most recent 100 events.
- `GET /api/student/analytics/trading` returns practice trading analytics.

No request field names a student: identity is `req.user.userId` only. Database changes: none (no new collection or index; one field on existing `progress` rows; covered by the existing app role).

## 3. Calculation definitions

- **Enrolled course:** an active enrollment (not withdrawn) in a course the student may still see; one per course.
- **Completed:** lib/course-progress.js completion. **In progress:** not complete, with a completed or viewed lesson.
- **Lessons completed:** completed ids that are still lessons of the course.
- **Overall progress:** lessons completed / lessons in all enrolled courses (lesson-weighted), to 0.1; null with no lessons.
- **Learning time:** active minutes (Phase 8 rule) by Africa/Lagos day. Every bucket is present, zeros included; "all" uses months.
- **Lessons over time:** first completion time per lesson. Completions before Phase 11 are undated. They count in totals, never in a time bucket, and the UI shows how many there are.
- **Quiz attempt:** a `quizScores` row (legacy rows included). **Pass rate:** passed / attempts that had a pass mark. **Quiz passed:** any attempt passed.
- **Upcoming quiz:** the student's open lesson (lock rule), not level-blocked, the quiz published with questions, and not passed (or attempted, with no pass mark).
  - Opens soon: before `availableFrom`. Closed and exhausted quizzes are left out.
- **Upcoming assignment:** an open lesson, or a course-level assignment with the course fully open, and not submitted. A date-only due date means the end of that day.
- **Milestones:** derived on read from the records above. A date appears only when the records hold one.
- **Recommendations:** deterministic priority rules. At most four, only accessible and not-yet-done items:
  1. resume;
  2. urgent or next assessment;
  3. retake;
  4. trades to review;
  5. practise;
  6. browse or next course.
- **Trading** (exact BigInt cents; strings out):
  - **Closed trade:** a `status:'closed'` position, over all accounts. Open and void positions are never trades; orders, executions and ledger rows are not counted.
  - **Results:** realised = stored `realizedPl`; win > 0, loss < 0, 0 = breakeven.
  - **Win rate:** wins / trades. **Average win / loss:** half-even to the cent.
  - **Daily series:** grouped by Lagos day, with a running total. Unrealised results are shown for the active account only, separately.

## 4. Security and isolation (tested)

- Route tests call the real handlers with the session stubbed. Student A with `?userId=B` still gets A's data. The handlers never read an identity from the query.
- Roles: `['student']` on every route; staff are refused. withAuth checks live role and status, so deactivated accounts are refused. Existing instructor and admin analytics and Super Admin-only approval are unchanged.
- No answer keys: quizzes are read with settings and question ids only; tests assert that `correctAnswer` never appears.
- Read-only: a write-watching proxy proves no write of any kind for all four entry points. The trading overview never runs the engine (no recovery, stop-loss or stop-out evaluation).
- Errors return the shared safe body; internals are never sent.

## 5. Performance

- Every read is scoped to the student and uses existing indexes: L1 progress, L8 learningDays, A6 quizScores, A4 quizzes, A1 quizAttempts, A2 submissions, T2/T9 trading, certificates (userId, courseId).
- The dashboard runs about 34 bounded queries, mostly in parallel, with no per-course or per-row queries.
- Known unindexed sorts, user-scoped and small: assignments by `courseId`; closed positions by `closedAt`.
- Score analytics scan the most recent 500 attempts (the exact attempt count is counted). The activity feed reads at most 100 events per source.
- There's no server cache (no cross-user risk). The client fetches once, and the charts are lazy-loaded (first load of `/dashboard` is 171 kB).

## 6. Limitations

- Lesson completion dates start with this phase; earlier completions are undated.
- Equity is valued at the latest simulated quote without running exits. The desk and the sweep still apply stop-losses as before.
- "Quizzes passed" and the average score use the most recent 500 attempts.
- Browser verification was not performed; see the session report.
