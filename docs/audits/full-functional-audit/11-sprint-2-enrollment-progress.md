# Sprint 2 — enrollment and progress integrity

Date: 26 October 2026. Local workspace only. No deploy, no production write, no seed, no progress deletion, no unique index, and no notification fan-out.

Sprint 3, later on the same date, records the product owner's acceptance of the withdrawn-enrollment policy. This file remains the Sprint 2 record. The acceptance, learning-level change, and later tests are in `12-sprint-3-functional-remediation.md`.

Release decision remains **BLOCKED**.

## Data flow

One `progress` document is one student's enrollment in one course. It stores `userId`, `courseId`, `progress` (percent), `completedLessons` (lesson id list), and timestamps. Active enrollment is a row for that user and course whose `active` is not `false` and whose `withdrawnAt` is absent. Rows written before this sprint have neither field, so they stay active.

Lesson completion history lives on that progress document. Quiz scores live in `quizScores`, queried by `{ userId, courseId }` through `quizHistoryQuery`. Certificates live in `certificates`. Unenroll does not write either collection.

`GET /api/progress` returns the caller's own rows, including withdrawn rows and rows whose course document is missing. Each view has `active`, `withdrawnAt`, `quizScores`, and `countsTowardActiveTotals`. That last flag is true only when the row is active and the course document was found. Dashboard completed-module totals and the progress-page course, completion, and average figures use the active flag. The progress page still lists withdrawn rows and their quiz scores, and its "Quizzes Taken" count includes those historical scores.

Active course or lesson aggregates after this sprint:

- Student dashboard enrolled courses: `pages/api/courses/index.ts` sets `enrolled` from `isActiveEnrollment`.
- Student dashboard completed modules: `sumActiveCompletedLessons`.
- Student progress page course, completed, and average totals: `countsTowardActiveTotals === true`.
- Instructor analytics student and in-progress counts: `isActiveEnrollment`.
- Admin analytics `totalEnrollments`, seven-day active users, and per-course enrolled/completed counts: `activeEnrollmentFilter`.
- Assignment analytics enrolled-student denominator: the same filter.
- Student certificate mint: active enrollment and progress of at least 100.

Admin `enrollmentTrends` still count progress documents by `createdAt`. That is a historical series, including courses later withdrawn. Leaderboard completions still come from certificates, not progress rows.

`studentOwnsEnrollment` is the student gate for lesson catalog and lesson read, lesson rooms, quizzes, assignments, lesson messages, and progress updates. It now requires `isActiveEnrollment`. Call sites that used to copy only `userId`, `courseId`, and `progress` now pass `enrollmentDecisionRecord`, which keeps `active` and `withdrawnAt`. `server.js` already passes the stored progress document, so those fields reach the socket decisions.

These readers had to understand inactive enrollment before withdrawal was safe. They now use the shared predicate:

- `pages/api/courses/index.ts`
- `pages/api/courses/[id].ts`
- `pages/api/lessons/index.ts`
- `pages/api/lessons/[id].ts`
- `pages/api/quizzes/[lessonId].ts`
- `pages/api/assignments/index.ts`
- `pages/api/assignments/[id].ts`
- `pages/api/assignments/[id]/submit.ts`
- `pages/api/assignments/[id]/analytics.ts`
- `pages/api/messages/index.ts`
- `pages/api/progress/index.ts`
- `pages/api/instructor/analytics.ts`
- `pages/api/admin/analytics.ts`
- `pages/api/certificates/index.ts` student generation
- `pages/dashboard.tsx`
- `pages/progress.tsx`
- `lib/account-access.js` `studentOwnsEnrollment`
- `server.js` through the raw progress document

`lib/learning-level.ts` was updated in Sprint 3 so a withdrawn row does not count as level progress. `pages/api/admin/send-certificate.ts` still issues when staff send a certificate. That remains a staff override, it does not reactivate the enrollment, and a new certificate stores `enrollmentActive`. The course list still looks up enrollment by string `courseId`, which matches new inserts.

A failed progress request is separate from an empty enrollment list. The student dashboard and the student progress page show "Progress could not be loaded". The dashboard completed-module figure is an em dash on that failure. Those pages were not opened in a browser because the local server is attached to the shared database and no disposable account was approved.

## Files changed

- `lib/enrollment-state.js` and `lib/enrollment-state.d.ts`
- `lib/account-access.js`
- `pages/api/courses/[id]/enroll.ts`
- `pages/api/progress/index.ts`
- `pages/api/courses/index.ts`
- `pages/api/courses/[id].ts`
- `pages/api/lessons/index.ts`
- `pages/api/lessons/[id].ts`
- `pages/api/quizzes/[lessonId].ts`
- `pages/api/messages/index.ts`
- `pages/api/assignments/index.ts`
- `pages/api/assignments/[id].ts`
- `pages/api/assignments/[id]/submit.ts`
- `pages/api/assignments/[id]/analytics.ts`
- `pages/api/instructor/analytics.ts`
- `pages/api/admin/analytics.ts`
- `pages/api/certificates/index.ts`
- `pages/dashboard.tsx`
- `pages/progress.tsx`
- `hooks/useProgress.ts`
- `tests/enrollment-state.test.js`
- `package.json` test script
- this audit set, the release table, and the release canvas evidence line

Sprint 1 notification modules and `tests/notification-access.test.js` were not edited. The notification fan-out was not run.

## Product decision

Accepted by the product owner on 26 October 2026:

"When a student unenrolls, the enrollment record remains stored as inactive with "withdrawnAt". Lesson-completion history, quiz scores, and certificates are retained. Withdrawn courses are excluded from active dashboard and completion totals. Enrolled-student lesson, quiz, and assignment access is denied while enrollment is inactive. Re-enrollment reactivates the existing record and preserves the student's history."

The Sprint 2 code already implemented that rule. Sprint 3 removed the "not accepted" labels. Existing rows without `withdrawnAt` stay active. No stored row was updated. The acceptance does not authorize an index or a deployment.

Repeated enrollment contract used by the tests: a second POST while the row is active returns 400 `{ error: "Already enrolled" }` and writes nothing. A POST while the row is withdrawn reactivates that same document, removes `withdrawnAt`, and keeps `completedLessons` and the percent.

## Schema and migration

No migration ran. No index was created. No production or shared database was scanned.

Prerequisite before a unique index on `(userId, courseId)`:

1. An approved read-only count of progress documents that share the same `userId` and `courseId`.
2. Approval to repair any duplicates that count finds. That repair is not authorized now.
3. Confirmation that `courseId` is one BSON type. New inserts store a string. A string and an ObjectId of the same hex value would not collide under one unique key. The enroll lookup reads both shapes so a second string row is not added when an ObjectId row is already present, but that check is still check-then-insert until the index exists.

Duplicate-key code 11000 and `DuplicateKey` already map to 400 `{ error: "Already enrolled" }`. Other write errors return 500 `{ error: "Internal server error" }` without `error.message`.

The notification `(userId, dedupeKey)` unique index is still absent. Concurrent notification retries can still create two personal copies. This sprint does not add that index.

## Regression tests and outcomes

`tests/enrollment-state.test.js`, 11 passed, exit code 0:

1. Authorized enrollment inserts one active row.
2. A missing course returns 404 and the repository stays empty.
3. A malformed id returns 400 and writes nothing.
4. Instructor, admin, superadmin, and a missing role return 403.
5. A second active enrollment returns 400 and writes nothing.
6. Withdrawal keeps the same row, `completedLessons`, and percent. A later enroll reactivates that row.
7. Two enroll decisions that both saw no row: the first commit inserts, the second raises 11000, and the handler returns 400. One row remains. `DuplicateKey` maps to the same 400. An unrelated code maps to 500.
8. A withdrawn row keeps its quiz score and is excluded from the active lesson sum. An orphan course row is also excluded. One active lesson is counted.
9. Quiz history query is `{ userId, courseId }` for the caller.
10. A withdrawn row does not pass lesson catalog or progress update. A legacy row without `withdrawnAt` still does. Another user's enrollment does not.
11. The enroll route source has no `deleteOne` and no `createIndex`. The dashboard calls `sumActiveCompletedLessons` and has the load-failure copy.

`npm test`: 164 passed, 0 failed, exit code 0. Duration about 9.7 seconds. Notification tests stayed in the suite.

## Commands

| Command | Exit |
| --- | --- |
| `node --test tests/enrollment-state.test.js` | 0 |
| `npm test` | 0 |
| `npx tsc --noEmit --incremental false --pretty false` | 0 |
| `npx eslint` on the Sprint 2 files listed in `07-test-evidence.md` | 0 (0 errors, 39 warnings) |
| `node --check server.js` | 0 |

No production write, seed, fan-out, or index command was run.

## Blockers and residual risk

- The withdrawn-enrollment decision was accepted on 26 October 2026. See `12-sprint-3-functional-remediation.md`.
- `(userId, courseId)` is not unique in the database. The race handler is tested. The race itself remains possible in MongoDB.
- Historical duplicate progress rows are unknown because production was not scanned.
- `(userId, dedupeKey)` is still not unique for notifications.
- Admin enrollment trends remain historical `createdAt` counts.
- Dashboard and progress-page copy were not verified in a browser.
- CTA-002, CTA-003, NOTIF-005, and the class half of NOTIF-007 were still open at the end of Sprint 2. Sprint 3 addresses them.
- Damian25 revocation, Render runtime proof, the eight smoke tests, and the three remaining moderate advisories remain open. Release stays blocked.

## Recommendation

Proceed with blockers. CTA-004 and PROGRESS-003 are covered by passing tests. PROGRESS-001 and PROGRESS-002 are covered by passing tests, and the product owner accepted the withdrawn rule on 26 October 2026. PROGRESS-007 is not closed until the unique index is approved and applied to a database that has been checked for duplicates. Do not deploy.
