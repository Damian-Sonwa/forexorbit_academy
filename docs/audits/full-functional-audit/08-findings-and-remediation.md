# Findings and remediation

The findings below record the audit. Sprint 1 later changed notification authorization. Severity is user impact plus data integrity. Security items that expose or overwrite another person’s notification state are high.

## Confirmed

### NOTIF-001 Mark-read ignores the recipient

- Severity: high. Any logged-in user who knows an id can set `read: true`.
- Roles: all authenticated.
- Files: `pages/api/notifications/index.ts` `markAsRead`; `pages/api/notifications/mark-all-read.ts`.
- Model: `notifications.read`.
- Reproduction: authenticate as user A, `PUT` a notification id stored for user B.
- Expected: update only when the caller is the target, or when the document is a personal copy.
- Actual: `findOne` then `updateOne` with no owner comparison.
- Evidence: static. The ownership comment is not implemented.
- Impact: read-state tampering.
- Root cause: missing authorization after the load.
- Fix: compare caller id and role with the document; return 404 when it does not match. Do not update shared documents in place.
- Test: `tests/notification-access.test.js` marks another user's copy as 404 and leaves it unread.
- Status: fixed in Sprint 1. `PUT` updates only a row whose `userId` is the caller and whose room, when present, is authorized. A foreign id and a missing id both return 404 `{ error: "Notification not found" }`. Verified by the in-memory regression tests on 26 October 2026.

### NOTIF-002 One read flag serves every recipient

- Severity: high.
- Roles: student, instructor, admin, superadmin.
- Files: `lib/notifications.ts`, `pages/api/notifications/index.ts` create and mark-all.
- Expected: each recipient has an independent unread state.
- Actual: role-wide and `all` notifications are one document. Mark-read flips `read` for every viewer. Superadmin mark-all matches `{ read: false }` with no user filter.
- Impact: users lose unread state because someone else read it.
- Fix: write one document per recipient, or store `readBy` and never return the full list. Filter mark-all to that recipient’s copies.
- Test: `tests/notification-access.test.js` creates two personal copies, marks one, and leaves the other unread.
- Status: fixed in Sprint 1. New role and `all` notifications are one document per recipient, each with its own `read` flag. Shared documents are not updated. Verified by the in-memory regression tests on 26 October 2026. Existing shared rows were not migrated.

### NOTIF-003 Student notification query is not limited to their room

- Severity: high if community-message notifications exist; the producer is currently commented out, so live volume may be low.
- Roles: student.
- File: `pages/api/notifications/index.ts` student branch. `roomName` is unused. The query matches every `community_message` with a `roomId`.
- Expected: only that student’s level or their own user id.
- Actual: any such document is returned.
- Fix: remove the broad clause or match the caller’s room only.
- Test: `tests/notification-access.test.js` gives a beginner student both room copies and returns only the Beginner room.
- Status: fixed in Sprint 1. The list query no longer matches every `community_message` with a `roomId`. Room membership comes from `decideCommunityRoomJoin`. Verified by the in-memory regression tests on 26 October 2026. The community-message producer in `pages/api/community/messages.ts` is still commented out.

### NOTIF-004 Superadmin mark-all clears every unread row

- Severity: high. Included with NOTIF-002.
- Status: fixed in Sprint 1. Mark-all for every role, including superadmin, uses `ownedNotificationQuery` with that caller's `userId`. Verified by the in-memory regression tests on 26 October 2026.

### NOTIF-005 Classes do not notify anyone

- Severity: medium. Missing behavior, not a broken sender.
- Roles: instructor creates; students would be the audience.
- File: `pages/api/classes/index.ts`.
- Expected: product decision. If classes are appointments, create `live_class_reminder` for the intended students and update or cancel those rows when the class changes.
- Actual: only the `classes` document changes. `GET` also returns `error.message` on failure.
- Fix: after the product rule exists, create per-student notifications. Replace raw errors with a fixed string.
- Test: create class in an isolated database and assert notification rows.
- Status: application behavior added in Sprint 3. Active enrollments of a caller-authorized course receive one personal notification for create, reschedule, and cancel. A class without `courseId` notifies nobody. Verified by `tests/sprint-3.test.js` in memory. No class was written to MongoDB, and no email was sent. See `12-sprint-3-functional-remediation.md`.

### NOTIF-006 Reminder delivery is not scheduled

- Severity: medium.
- File: `pages/api/reminders/check.ts`. Admin or superadmin POST only. No cron entry was found.
- Expected: due reminders notify the owner inside the 15-minute window without a person calling the route.
- Actual: nothing runs unless that route is called.
- Fix: a scheduled job using a service credential, still writing per-user rows.
- Status: application window prepared in Sprint 3. The route stays admin or superadmin only and uses the 15-minute due window. No scheduler was created and Render was not changed. Delivery remains blocked until an operator schedules the authenticated route outside this workspace.

### NOTIF-007 Notification and class errors return exception text

- Severity: medium.
- Files: `pages/api/notifications/index.ts`, `pages/api/notifications/mark-all-read.ts`, `pages/api/classes/index.ts`.
- Expected: a fixed client message and a server log without the exception text in the response.
- Actual at audit time: `message: errorMessage` or `{ error: errorMessage }`.
- Status: fixed for the class and reminder handlers in Sprint 3. Those responses use fixed client messages. `tests/sprint-3.test.js` asserts the handlers do not return `error.message`. Notification routes were already covered by Sprint 1. This was a source assertion, not a live thrown exception over HTTP.

### CTA-002 Staff progress route is missing

- Severity: high.
- Roles: instructor, admin, superadmin.
- File: `pages/progress.tsx` calls `/progress/all`. No API module exists.
- Expected: staff see an authorized aggregate or the nav item is removed.
- Actual: request cannot succeed. Loading ends in `finally` with a console error.
- Fix: add an authorized route that does not dump every student’s raw record, or point staff at instructor analytics.
- Test: staff token receives 200 or the link is absent; student token cannot read other users.
- Status: fixed in Sprint 3 for the aggregate decision. `GET /api/progress/all` returns course counts for instructor, admin, and superadmin, and 403 for a student. Instructor scope uses `canReadCourseLessons`. `tests/sprint-3.test.js` passed. The HTTP route was not called against MongoDB, and the page was not opened in a browser.

### CTA-003 Feature flags do not cover APIs

- Severity: high.
- Files: `lib/config/features.ts`, `middleware.ts`, community and consultation API routes.
- Expected: hidden products are refused by the API with the same flag.
- Actual: pages redirect; APIs remain.
- Fix: share `isFeaturePathBlocked` or a feature check inside those handlers. Keep `/consultations/admin` available only to superadmin.
- Test: flag false, community GET returns 404; flag true, authorized member succeeds.
- Status: fixed in Sprint 3 at the shared flag boundary. Blocked APIs return 404 `{ error: "Not found" }`. `/api/consultations/admin` stays outside the consultation flag. `tests/sprint-3.test.js` covers the flags disabled and enabled. That test calls the decision function. It is not an HTTP integration test.

### CTA-004 Enroll accepts an unknown course id

- Severity: high.
- File: `pages/api/courses/[id]/enroll.ts`.
- Expected: 404 when the course is missing.
- Actual: `insertOne` into `progress`.
- Fix: load the course first. Use a unique index on `(userId, courseId)`.
- Test: isolated fixtures. A missing course returns 404 and writes nothing. A malformed id returns 400 and writes nothing.
- Status: fixed in Sprint 2. `tests/enrollment-state.test.js` passed on 26 October 2026. The route validates the id before any write, loads the course by ObjectId, and returns the decision error. No schema migration was added.

### PROGRESS-001 Unenroll deletes the progress document

- Severity: high.
- Roles: student.
- File: `pages/api/courses/[id]/enroll.ts` `deleteOne`.
- Expected: active dashboards exclude the course and keep lesson history, quiz scores, and certificates.
- Actual: the only enrollment row, including `completedLessons` and percent, is deleted. Active totals therefore drop, which meets the exclusion half and fails the retention half.
- Fix: set `active: false` and `withdrawnAt`. Filter active aggregates with `active !== false`. Do not delete `quizScores`.
- Test: unenroll, assert the row remains inactive, dashboard query excludes it, quiz score remains.
- Status: fixed. The product owner approved the withdrawn-enrollment policy on 26 October 2026. `DELETE` sets `active: false` and `withdrawnAt` and does not call `deleteOne`. Re-enrollment reactivates the same row. Verified by `tests/enrollment-state.test.js`. No stored student row was updated by this approval.

### PROGRESS-002 Quiz scores survive unenroll but vanish from progress views

- Severity: medium.
- Files: enroll delete; `quizScores` writers in `pages/api/quizzes/[lessonId].ts`; `GET /api/progress` joins scores only for remaining progress rows.
- Expected: retained scores visible in history, excluded from active percent.
- Actual: scores remain orphaned and unshown.
- Status: fixed under the policy approved on 26 October 2026. `GET /api/progress` still returns the caller's own `quizScores` for a withdrawn row, and `countsTowardActiveTotals` is false. Scores were not rewritten. Verified by `tests/enrollment-state.test.js`.

### PROGRESS-003 Dashboard counts lessons from progress rows with no course

- Severity: medium.
- Files: `pages/api/progress/index.ts` returns `course: null`; `pages/dashboard.tsx` `completedModules` sums every row.
- Expected: rows whose course no longer exists do not add to active totals.
- Actual: the sum does not check `course`.
- Status: fixed in Sprint 2. `sumActiveCompletedLessons` ignores a row whose `course` is null. Verified by `tests/enrollment-state.test.js`. This exclusion does not depend on the withdrawn-enrollment decision.

### PROGRESS-007 Concurrent enroll can insert two rows

- Severity: medium. Suspected race; the check-then-insert is confirmed.
- File: `enroll.ts`.
- Fix: unique index and handle duplicate-key as 400.
- Status: handler verified, index unapplied. `tests/enrollment-state.test.js` runs two enroll decisions that both observed no existing row, then commits both against an in-memory unique key. The second commit raises duplicate key 11000 and maps to 400 `{ error: "Already enrolled" }`. One row remains. No unique index was created on any database. MongoDB can still store two rows until that index is approved. Historical duplicates were not scanned.

### CTA-001 Dashboard copy overstates instructor access

- Severity: medium.
- Files: `pages/instructor/dashboard.tsx`, `pages/instructor/courses/[courseId].tsx`.
- Expected: only assigned courses offer lesson management.
- Actual: links still open every course; the course page then withholds lessons.
- Status: code updated in Sprint 3. Instructor dashboard course links render only when `canReadCourseLessons` allows the course. The page was not opened in a browser.

### CTA-005 Notification click does not navigate

- Severity: medium.
- File: `components/Header.tsx`.
- Status: code updated in Sprint 3. A click navigates only for a safe internal `metadata.href` and still mark-reads through the owned notification API. `notificationDestination` is covered by `tests/sprint-3.test.js`. The header was not clicked in a browser.

### LOAD-002 Progress errors look like an empty list

- Severity: medium.
- File: `pages/progress.tsx` catch logs and `finally` clears loading. No retry control.
- Status: code updated in Sprint 3. The student and staff views show "Progress could not be loaded" with Try again, separate from an empty list. CTA-002 now has an aggregate route. The page was not opened in a browser.

### LOAD-003 Student dashboard treats a failed progress load as zero enrollments

- Severity: medium.
- Files: `hooks/useProgress.ts`, `pages/dashboard.tsx`. `error` is not rendered. Empty copy says the student has not enrolled.
- Status: code updated in Sprint 2 and given a Try again control in Sprint 3. The completed-module figure stays an em dash on failure. The page was not opened in a browser.

### CROSS-001 through CROSS-007

Recorded in `06-cross-feature-regression.md`. They are the same defects seen across features, not extra root causes.

## Product decisions

1. Withdrawn enrollment remains stored as inactive with `withdrawnAt`. Lesson-completion history, quiz scores, and certificates are retained. Withdrawn courses are excluded from active dashboard and completion totals. Lesson, quiz, and assignment access is denied while enrollment is inactive. Re-enrollment reactivates the same record and preserves history. Status: accepted by the product owner on 26 October 2026. The approval does not authorize an index migration or a deployment.
2. Class notifications go to active enrollments of the selected course. A class without a course notifies nobody. Status: implemented in Sprint 3. No database index was added.
3. Certificates, community, and consultation APIs follow the same flags as their pages and return 404 while the flag is false. `/consultations/admin` and `/api/consultations/admin` stay outside that flag. Status: implemented in Sprint 3.
4. Sprint 1 answers the security half: a superadmin mark-all and list are limited to that superadmin's own copies. A separate operational feed, if wanted, needs its own decision.

## Remediation order

1. NOTIF-001, NOTIF-002, NOTIF-004, NOTIF-003. Fixed in Sprint 1. See `10-sprint-1-notification-security.md`. The legacy fan-out migration was not run.
2. PROGRESS-001, CTA-004, PROGRESS-003, and the PROGRESS-007 duplicate-key handler are in Sprint 2. See `11-sprint-2-enrollment-progress.md`. The withdrawn rule was accepted on 26 October 2026. The `(userId, courseId)` unique index was not created.
3. CTA-002 and CTA-003 are in Sprint 3. See `12-sprint-3-functional-remediation.md`. The aggregate and flag decisions passed in memory. They were not browser-tested.
4. LOAD-002, LOAD-003, CTA-001, and CTA-005 have code updates. NOTIF-005 and NOTIF-007 have in-memory or source tests. NOTIF-006 still needs an operator scheduler. Browser checks were not run.

Each step needs the regression test named on the finding, run against an isolated database when it writes.
