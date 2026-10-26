# Test evidence

Environment: local workspace `forexorbit_academy-master`, 26 October 2026. Node test runner. No `MONGO_URI` is read by these tests. No browser, no production host, no SMS.

## Executed

Command: `npm test`

Result: 143 passed, 0 failed, 0 skipped. Duration about 2.4 seconds. Exit code 0.

Classification: unit tests of authorization decisions and source-shape checks. They are not API integration tests, database tests, or end-to-end tests.

Relevant coverage inside that run:

- Enrolled versus non-enrolled lesson and quiz access
- Progress update refuses a missing enrollment
- News `isRead` without returning `readBy`
- Community room and socket authorization
- Session binding after password reset
- Course response allowlist

## Not executed

- `npx tsc` and `next lint` were run in an earlier readiness pass, not repeated as evidence for this functional audit.
- No Playwright, Cypress, or Puppeteer package is installed. Browser E2E is unavailable.
- No isolated test database was configured for the audit, so enroll, unenroll, and class create were not executed. Sprint 1 later exercised notification writes in an in-memory store, recorded below.
- Production pages were not used as functional proof.

## Sprint 1 notification security

Command: `node --test tests/notification-access.test.js`

Result: 10 passed, 0 failed. Exit code 0. Duration about 0.2 seconds. The store is in-memory. No `MONGO_URI` was used.

Command: `npm test`

Result: 153 passed, 0 failed, 0 skipped. Exit code 0. Duration about 5.2 seconds. The previous 143 tests remain in that run.

Command: `npx tsc --noEmit --incremental false --pretty false`

Result: exit code 0. Duration about 109 seconds. No diagnostics.

Command: `npx eslint` on `pages/api/notifications/index.ts`, `pages/api/notifications/mark-all-read.ts`, `lib/notifications.ts`, `lib/notification-access.js`, and `tests/notification-access.test.js`

Result: 0 errors, 7 warnings. Exit code 0. The warnings are the existing `require()` style used by the other unit tests and one `any` on notification metadata.

These tests do not execute the handlers against MongoDB. They execute the recipient rules and a memory store, and they check that the notification routes call `ownedNotificationQuery` and do not return `error.message`.

## Sprint 2 enrollment and progress

Command: `node --check lib/enrollment-state.js`; `node --check lib/account-access.js`; `node --test tests/enrollment-state.test.js`

Result: 11 passed, 0 failed. Exit code 0. Duration about 0.3 seconds. No `MONGO_URI` was used. The concurrency case is two decisions that both observed no row, then two commits against an in-memory unique key. It is not a sequential "already enrolled" check and it is not a live MongoDB unique index.

Command: `npm test`

Result: 164 passed, 0 failed, 0 skipped. Exit code 0. Duration about 9.7 seconds. The Sprint 1 notification tests remain in that run.

Command: `npx tsc --noEmit --incremental false --pretty false`

Result: exit code 0. Duration about 107 seconds. No diagnostics.

Command: `npx eslint` on the Sprint 2 enrollment, progress, dashboard, lesson, quiz, assignment, analytics, and certificate files, plus `lib/account-access.js` and `tests/enrollment-state.test.js`

Result: 0 errors, 39 warnings. Exit code 0. The warnings are existing `any` and `require()` style, plus the progress page hook dependencies that were already present.

Command: `node --check server.js`

Result: exit code 0. `server.js` was not edited. It already passes the stored progress document into the lesson and progress decisions, so `withdrawnAt` on that document is visible to `studentOwnsEnrollment`.

These tests do not write to MongoDB. They do not prove a browser render of the dashboard or the progress page.

## Post-revocation build verification

Command: `npm run build`

Result: exit code 0. Next.js 15.5.28. Duration about 333 seconds. The workspace `.next` directory had been removed first. No deploy followed.

Command: `npm test`

Result: 164 passed, 0 failed, exit code 0. Duration about 11.3 seconds. Notification and enrollment tests remained in the run.

Command: `npx tsc --noEmit --incremental false --pretty false`

Result: exit code 0.

Command: `node --check server.js`

Result: exit code 0.

Command: `npx next lint --max-warnings 10000`

Result: exit code 0. 0 errors, 595 warnings.

Command: `npm audit`

Result: exit code 1. 3 moderate, 0 high, 0 critical. Packages: `postcss-selector-parser`, `quill`, `react-quill`.

The new build scan found 86 `mongodb://` or `mongodb+srv://` scheme mentions and 0 credential-shaped URIs. No email or SMS was sent. `lib/email.ts` is not imported by a route.

## Sprint 3 functional remediation

Command: `node --test tests/sprint-3.test.js tests/enrollment-state.test.js tests/notification-access.test.js`

Result: 28 passed, 0 failed. Exit code 0. In-memory and source-shape tests. No `MONGO_URI`.

Command: `npm test`

Result: 171 passed, 0 failed. Exit code 0. Runner duration about 3.9 seconds. This run includes Sprint 1, Sprint 2, and `tests/sprint-3.test.js`. It was executed before the later approval-comment wording change.

Command: `node --test tests/enrollment-state.test.js tests/sprint-3.test.js`

Result: 18 passed, 0 failed. Exit code 0. Executed after the approval-comment wording change.

Command: `npx tsc --noEmit --incremental false --pretty false`, then `node --check server.js`

Result: both exit code 0. Combined duration about 57 seconds. The later `npm run build` also typechecked the final source.

Command: `npx eslint` on the Sprint 3 files named in `12-sprint-3-functional-remediation.md`

Result: exit code 0. 0 errors, 112 warnings. A separate full `npx next lint` was not run.

Command: `npm audit`

Result: exit code 1. 3 moderate, 0 high, 0 critical. Packages: `postcss-selector-parser`, `quill`, `react-quill`.

Command: `npm run build`

Result: exit code 0. Next.js 15.5.28. Compile phase succeeded in 47 seconds. The build log contains 607 `Warning:` lines and the build continued. The new workspace pack is 120,110,904 bytes, SHA-256 `337BF0B6142B29477F9144BB3EB1014737909B7EB0BAEE70A4EAEDB7CA7F83CB`. The scan found 86 scheme mentions and 0 credential-shaped URIs.

These Sprint 3 tests do not write to MongoDB and do not open a browser. The in-memory enrollment concurrency case is not a live unique index.

## Follow-up verification

Command: `npm test`

Result: 171 passed, 0 failed. Exit code 0. Runner duration about 5.0 seconds. This run is on the final Sprint 3 source, including the approval-comment wording.

Command: `npx tsc --noEmit --incremental false --pretty false`, then `node --check server.js`

Result: both exit code 0.

Command: `npx eslint` on the Sprint 3 files with `--quiet`

Result: exit code 0. 0 errors.

Command: `npm audit`

Result: exit code 1. 3 moderate, 0 high, 0 critical.

`npm run build` was not repeated because a development server is listening on port 3000. A read-only scan of the existing `.next` output found 0 credential-shaped URIs.

## Limitation

A handler that is present in source can still fail at runtime. Findings in the original audit were source-confirmed unless the status says suspected. NOTIF-001, NOTIF-002, NOTIF-003, and NOTIF-004 are marked fixed only in `08-findings-and-remediation.md` after the Sprint 1 run above.
