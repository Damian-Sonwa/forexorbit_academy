# Phase 8: learning progress and student tracking

Branch `feat/phase-8-learning-progress`, worktree `forexorbit_academy-phase-8-learning-progress`, from `a1cc331` (the committed Phase 7). Nothing is committed, pushed, merged or deployed. **Production action needed:** build indexes L8 and L9 (section 7). No production data, index or setting was touched.

## 1. How it worked before (audit)

**Records**
- `progress` (one row per student and course, unique E1 `progress_user_course`) holds `completedLessons` (history, ids never removed), `progress` (stored percentage), and `completedAt` (permanent). Rows are never deleted; withdrawal sets `active: false`.
- Completion is written by `POST /api/progress` and the legacy socket `progressUpdate`. Both use the enrollment rule and, since Phase 6 and Phase 7, the paywall. Writes go through `recordLessonCompletion`, which uses `$addToSet`. The percentage is measured against the course's current lessons, capped at 100, and recomputed when lessons are added or deleted.
- Certificates (`POST /api/certificates`) require the authoritative completion (`courseCompletion`), an active enrollment and full course access (`allOpen`). The feature is off (`FEATURES.CERTIFICATES = false`).

**Not present:**
- learning time;
- activity events;
- streaks;
- recent activity;
- last-viewed lesson;
- any cross-tab or cross-device update (the socket handler answered only the sending socket).

**Indexes in use**

| Index | Key | Kind |
|---|---|---|
| L1 | `progress { userId }` | |
| E1 | `progress { userId, courseId }` | unique |
| L2 | `lessons { courseId, order }` | |
| I4 | `userCourseAccess { userId, courseId }` | unique |

## 2. Findings

| # | Severity | Finding | Effect |
|---|---|---|---|
| P8-1 | **High (data integrity)** | `recordLessonCompletion` added the lesson atomically, then stored the recomputed percentage from its own snapshot in a second write. Parallel completions (two tabs or two devices) could finish in either order. | The stored percentage could stay at an older, lower value. On a real MongoDB server, without the fix, 24 parallel completions of 12 lessons left **91.67 %** stored after every lesson was complete (`tests/integration/progress-phase8-mongo.test.js`). |
| P8-2 | Medium | `GET /api/progress` `completedLessonsCount` and the dashboard's "Lessons completed" counted every stored id, including deleted lessons and lessons of other courses. | Inflated counts such as "7 / 5 lessons". |
| P8-3 | Medium | The dashboard and progress page counted completed courses as `progress >= 100`, ignoring `completedAt`. | A course completed before lessons were added showed as in progress on the dashboard but as completed on the course page. |
| P8-4 | Medium | The dashboard "Continue learning" sent one `/api/lessons?courseId=` request per in-progress course (N+1). It ignored lock state, skipped enrolled-but-unstarted courses, and had no last-viewed lesson. | Slow dashboard; Continue could point at a locked lesson; resume did not follow the student. |
| P8-5 | Medium | No synchronization: completions reached only the tab that made them (socket path) or nothing at all (HTTP path). | Other tabs and devices showed stale progress until reloaded. |
| P8-7 | **High (found by the Phase 8 browser test)** | `lib/socket-server` kept the Socket.IO instance in a module variable. `server.js` sets it via Node `require`, but Next.js bundles API routes with their own copy of the module, so `getSocketServer()` was always `null` in routes and `req.io` was never set. | No HTTP route could broadcast anything: Phase 8 sync, and also the existing live consultation chat messages and live notifications (classes, demo tasks, reminders, community mentions), which only appeared after a refresh. Fixed by keeping the instance on `globalThis` (`lib/socket-server.js` / `.ts`). The first browser run failed exactly the 4 live-update checks (26/30); after the fix it passed 30/30. The consultation chat and the header notification list already ignore duplicate ids; each route emits once to the intended `user:<id>` or room; the community page has no `message` listener, so those emits stay unused. |
| P8-6 | Low | `scripts/learning-indexes.js` skipped collections that did not exist yet and ignored TTL options. | It could not build indexes for new collections (needed for P8 L8 and L9). |
| — | Not a defect | Certificates already follow the authoritative completion and Phase 6 access. | Unchanged. |

## 3. What was implemented

### 3.1 Lesson completion and course percentage
- **P8-1 fix:** `lib/course-progress.js` stores the recomputed percentage only while no newer completion has been added. It does this with a compare-and-set on the array length, `completedLessons.<n>: { $exists: false }`; the array only grows. Whichever request saw the longest list writes, so the stored value always matches the full list. `completedAt` stays conditional and permanent.
- The pure calculations (`currentCompletedIds`, `progressPercent`, `courseCompletion`) moved, unchanged, to `lib/progress-math.js`, which has no dependencies. `lib/course-progress.js` re-exports them. During this phase `lib/enrollment-state.js` briefly imported `course-progress` directly; that file references the MongoDB driver, and `enrollment-state` is also bundled into browser pages, so the production build failed. It now imports only `progress-math`, and a test walks its import graph so this cannot happen again.
- **P8-2 and P8-3:** `lib/enrollment-state.js` `presentEnrollmentProgress` now counts completed ids that are still lessons of the course. It adds `status` (`completed` / `in_progress` / `not_started`, from `courseCompletion`), `completedAt` and `lastViewedAt`. `lib/progress-views.js` passes the lesson ids it already loads, so no extra query is needed. The dashboard and progress page use the status.

### 3.2 Resume learning and last-viewed lesson
- `POST /api/progress/activity` with `event: 'view'` sets `lastLessonId` and `lastViewedAt` on the enrollment row, only if no newer view is stored. Each signal moves `lastActivityAt` forward (`$max`).
- The Continue rule is in `lib/progress-summary.js` and section 4.6. It skips locked lessons, deleted lessons, draft or in-review courses and completed courses.
- The Phase 7 per-browser video position is unchanged and still restores the position inside the lesson.

### 3.3 Learning time, streaks and recent activity
- Activity rules: `lib/learning-activity.js`, documented in section 4.
- Client signals: `hooks/useLearningActivity.ts`, used on the lesson page; video playback also counts as activity.
- New collections:
  - `learningMinutes`: one row per student per minute, kept 90 days.
  - `learningDays`: one row per student per day.
- Summary: `GET /api/progress/summary` returns learning time today, over the last 7 days and in total, the current and longest streak, and a 7-day activity strip.

### 3.4 Completed and in-progress lists
- `GET /api/progress/summary` returns:
  - `courses`, `inProgress` (most recently studied first), `completed` (most recently completed first) and `recent` (last five viewed);
  - totals for the active enrollments in courses the student may see.
- Each course appears once, even with an old row whose course id is stored as an ObjectId.
- `components/student/LearningSummary.tsx` renders them on the dashboard.

### 3.5 Cross-tab and cross-device synchronization
- After a completion is persisted, `POST /api/progress` and the socket handler emit `progressUpdated` to the account's Socket.IO room `user:<id>`. Every tab and device of that account joins this room on connect; no other account does.
- `hooks/useProgressSync.ts`: the lesson page marks the lesson and outline done, and the course page and dashboard refetch from the server. It also refetches when the tab regains focus or becomes visible, when the browser comes back online, and when the socket reconnects. Refetches are throttled to one per 5 s; there is no polling.
- The server stays authoritative: every displayed number is re-read from it, and the client never computes progress for storage.

### 3.6 Certificates
Unchanged by design. The audit confirmed:
- completion comes from `courseCompletion`, which ignores deleted-lesson inflation;
- the enrollment must be active;
- the full course must be open, so a refund with access removal blocks issue (Phase 6);
- one certificate per student and course (unique index).

The feature stays off. Tests cover these rules through the real route.

### 3.7 Queries and indexes
- `GET /api/progress/summary` runs **7 queries regardless of the number of courses** (tested with 1 and 13 courses). The lesson read uses a navigation-only projection; no lesson bodies are read.
- The dashboard's N+1 is removed: one summary request replaces one request per course.
- New indexes, added to `lib/learning-indexes.js` and built by the existing `scripts/learning-indexes.js`:
  - **L8** `learningDays { userId: 1, day: -1 }` (`perf_learning_days_user`): the streak and time query.
  - **L9** `learningMinutes { at: 1 }` (`ttl_learning_minutes`, TTL 90 days): bounds the growth of minute rows.
- `progress` uses the existing L1 and E1; no new `progress` index. The script now builds indexes for collections that do not exist yet and checks TTL options.

## 4. Data integrity and calculation rules

1. **Completed lesson.** A lesson id in `completedLessons`, recorded only by the explicit, gated completion action (`POST /api/progress` or the gated socket path). Watching a video never completes a lesson (Phase 7). Recording is idempotent (`$addToSet`).
2. **Course percentage.** Let `current` = ids of the course's lessons now, and `done` = `completedLessons` ∩ `current`. Then `percent = min(100, |done| / |current| × 100)`, and 0 when the course has no lessons. Ids of deleted lessons or other courses never count.
3. **Course completed.** `completedAt` is recorded the first time `percent` reaches 100 and is never cleared. Rows from before `completedAt` existed count when the stored 100 is not made of deleted lessons (`courseCompletion` 'historical'). A completed course stays completed when lessons are added, and its percentage then shows coverage of the current lessons.
4. **Deleted or reordered lessons.** Order never affects completion. Deleted ids stay in history but stop counting. Adding or deleting a lesson recomputes every enrollment of the course.
5. **Active minute and learning time.**
   - The client sends a signal only while the lesson page is visible and the student interacted with it (pointer, key, scroll, touch, wheel) or a video played within the last **60 s**. It sends one every **30 s**, plus one when the lesson opens.
   - The server records at most one row per student per **UTC clock minute of the server's time** (`_id = <userId>:<YYYY-MM-DDTHH:MM>`). Learning time is the number of such minutes.
   - So: idle or hidden tabs add nothing; several tabs, devices or retries in one minute count once; time can never exceed wall-clock time; and nothing is backfilled after being offline.
   - A minute is attributed to the course of the first signal in it.
6. **Learning day.** A calendar day in **Africa/Lagos** (UTC+1, no daylight saving; the platform's market) with at least one active minute. The timezone is a single platform setting (`LEARNING_TIMEZONE`), and every day boundary, streak and "today" figure uses it.
7. **Streak.**
   - **Current:** the number of consecutive learning days ending today, or ending yesterday when today has no activity yet. A streak is lost only after a whole day without learning.
   - **Longest:** the longest such run in the stored history.
   - Repeated requests cannot add days: only server time creates a new day.
8. **Last viewed lesson.** The lesson of the newest `view` event by server time. A delayed, older view never replaces a newer one.
9. **Continue learning.**
   - Pick the most recently studied course that is not completed: the latest of `lastViewedAt`, `lastActivityAt` and `updatedAt`, among active enrollments in courses the student may see.
   - In that course, offer the first of these that applies:
     1. the last viewed lesson, if it still exists, is open to the student and is not completed (`last_viewed`);
     2. otherwise, the next open, unfinished lesson after it in course order (`next_after_last_viewed`);
     3. otherwise, the first open, unfinished lesson (`first_unfinished`, or `last_viewed_unavailable` when the last viewed lesson was deleted);
     4. if only locked lessons remain: the course page, to unlock (`locked_remaining`).
10. **Concurrency.** Completions use `$addToSet` plus the compare-and-set on the percentage. Minutes are created with an upsert on a deterministic `_id`, so a lost race is a duplicate-key no-op, and the day counter is incremented only by the request that created the minute. Last viewed uses newest-wins (`$lte` guard), and last activity uses `$max`.

## 5. Security
- **Identity:** every new route takes the student from the Phase 4.5 session. Any `userId` in a body or query is ignored (tested).
- **Activity writes** follow the completion rules: own active enrollment, course published or archived, lesson belongs to that course, and the Phase 6 paywall. The course is derived from the stored lesson, not the request. Staff signals are not recorded.
- **Validation:** `lessonId` must be a 24-hex id and `event` must be `view` or `heartbeat`; operator objects are refused.
- **Session and CSRF:** state-changing calls need the session, the CSRF header and the exact Origin (middleware). There is a per-account rate limit (`learning-activity-account`, 300 per 10 minutes) through the existing limiter, which also uses the shared MongoDB store when `SHARED_RATE_LIMIT=mongodb`.
- **Privacy:** the summary contains only the caller's own data, with no lesson bodies and no other student. Responses are `private, no-store`. Broadcasts go only to the account's own room. Activity rows hold ids and timestamps only (no IP or device data); minute rows expire after 90 days.

## 6. Testing

Executed 1 November 2026 (exact counts in the hand-off summary and below).

- `npm test`: **859/859** unit and route tests (831 before Phase 8). They include `tests/phase-8-learning-progress.test.js` (26 tests: integrity, ownership, rate limit, privacy, sync, concurrency, offline replay, resume, analytics, timezone, lists, certificates, performance, socket module, browser-bundle safety).
- Mutation checks: removing the completion compare-and-set, the minute idempotency, the activity paywall, the newest-wins guard, the user-room target, the summary visibility rule or the resume lock rule each fails a test. Removing the activity enrollment check alone is still refused by the paywall gate (defence in depth).
- `npm run test:mongo:progress` (new, local test server): 3/3. Without the P8-1 fix the concurrency test fails (91.67 % stored after all 12 lessons were completed).
- `scripts/acceptance/progress-e2e.js` (new; real app, local MongoDB, headless Edge): two tabs of one browser (one in the background) and a second browser as a phone (390 px, own session): **30/30**.
- Regression: Phase 7 browser suite **73/73**; Phase 6 browser suite **42/42**; real-MongoDB enrollment unchanged.
- TypeScript 0 errors. The production build passes (after the browser-bundle fix in 3.1). ESLint: 0 errors and 636 warnings (627 before; the new ones are the repository's usual CommonJS `require()` warnings in the new libraries).
- The final Phase 8 browser run (30/30) was made on the final code, after the `progress-math` split.
- Not executed: Paystack charges (payment code unchanged), Firefox, Safari, and real phones (the phone is Edge at 390 px with its own session).

## 7. Database and infrastructure
- **New collections:** `learningMinutes` and `learningDays`, created on first write.
- **New fields** on `progress`: `lastLessonId`, `lastViewedAt`, `lastActivityAt`. Optional; existing rows need no migration.
- **New indexes:** L8 and L9. The owner builds them in production with `node scripts/learning-indexes.js --database <name>` (read-only report), then `--apply`, using a privileged account. Until they exist the feature works, but the streak query scans `learningDays`, and minute rows do not expire.
- **No** environment variables, external services or migrations.

## 8. Limitations
- **Learning time** measures active presence on lesson pages. Watching a video in another app or reading offline is not counted, by design.
- **Platform timezone:** students far from West Africa see day boundaries at Lagos midnight. Per-student timezones would need a profile setting, which is not in scope.
- **Video resume position** stays per browser (Phase 7). The resume lesson is cross-device (server-side).
- **Socket broadcast** reaches devices that are connected. Others catch up on focus, visibility, online or reconnect.
- **Quiz passes:** `pages/api/quizzes/[lessonId].ts` also records lesson completion through `recordLessonCompletion`, so it gains the P8-1 fix. Quiz behaviour itself is Phase 9 and unchanged.
