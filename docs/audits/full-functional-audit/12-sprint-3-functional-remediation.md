# Sprint 3 — functional remediation

Date: 26 October 2026. Local workspace only. This folder is not a git repository. No deploy, no production write, no seed, no progress deletion, no unique index, and no notification fan-out.

Release decision remains **BLOCKED**.

## Approved withdrawn-enrollment policy

The product owner approved this policy on 26 October 2026:

"When a student unenrolls, the enrollment record remains stored as inactive with "withdrawnAt". Lesson-completion history, quiz scores, and certificates are retained. Withdrawn courses are excluded from active dashboard and completion totals. Enrolled-student lesson, quiz, and assignment access is denied while enrollment is inactive. Re-enrollment reactivates the existing record and preserves the student's history."

That approval is recorded in `08-findings-and-remediation.md`, `11-sprint-2-enrollment-progress.md`, and `docs/audits/release-readiness-2026-10-26.md`. It is no longer a pending decision. It does not authorize a database index, a duplicate scan, or a production deployment. No existing student record was updated.

## Phase 0 inventory

The workspace was already carrying Sprint 1 notification isolation, Sprint 2 enrollment and progress changes, the release-readiness report, and the external forensic pack. Those files were kept. The external pack was not deleted. Sprint 3 added the files in the inventory below and did not revert Sprint 1 or Sprint 2 tests.

## Phase 1 — withdrawn enrollment

`isActiveEnrollment` remains the shared predicate. `studentOwnsEnrollment` still requires it, so inactive enrollment does not grant lesson, quiz, assignment, or progress-update access. Re-enrollment still reactivates the same progress document and keeps `completedLessons`.

`lib/learning-level.ts` now uses `courseCountsAsLevelProgress`. A withdrawn row, or an active row that has not completed every lesson, does not count as level progress. Admin `enrollmentTrends` still count historical `createdAt` rows.

Staff certificate issuance stays an administrative override. `decideStaffCertificate` allows admin and superadmin, denies an instructor, and sets `reactivatesEnrollment` to false. `pages/api/admin/send-certificate.ts` still issues when staff send a certificate, including when the enrollment is inactive. The new certificate document stores `enrollmentActive`. The progress row is not reactivated and is not counted in active totals. Existing certificates are not rewritten. Student self-mint still requires an active enrollment and progress of at least 100.

## Phase 2 — CTA-002

`GET /api/progress/all` is an aggregate for instructor, admin, and superadmin. A student is rejected with 403 before a query. Instructors see only courses that pass `canReadCourseLessons`. The response is course counts: active enrollments, completed, and in progress. It does not return emails, lesson ids, quiz scores, or raw progress documents. The staff progress page renders that aggregate and keeps a separate error state with retry. The student page still shows that student's own history, including withdrawn courses.

## Phase 3 — CTA-003

`lib/feature-access.js` is the shared flag module. `lib/config/features.ts` re-exports it. With the current flags false, middleware returns `404` `{ error: "Not found" }` for `/api/community`, `/api/certificates`, and `/api/consultations`, except `/api/consultations/admin`. Page paths for those products still redirect, except `/consultations/admin`. Unrelated routes such as `/api/courses` and `/api/progress` are not blocked by the flag check. Authentication and authorization on a route still run only when the flag allows the request to reach that route.

Intentional exceptions:

- `/consultations/admin` and `/api/consultations/admin` stay outside the consultation flag. The admin route keeps its own superadmin check.
- The existing public socket room `community_global` is unchanged.

## Phase 4 — notifications and classes

Sprint 1 per-recipient delivery is unchanged. The legacy fan-out was not run.

Class notifications go only to active enrollments of a valid `courseId` when the caller passes `canReadCourseLessons`. A class with no course has no audience and creates no notification. One `deliverNotification` copy is prepared per recipient, with that recipient's own read state. Dedupe keys are `class:{id}:created`, `class:{id}:cancelled`, and `class:{id}:schedule:{date}:{time}`. A date or time change sends the reschedule notice. Cancellation sends the cancelled notice before the class row is removed. No unique index was added. No email or SMS is sent by this path.

The instructor and admin class forms can select a course. "No course notification" leaves `courseId` empty. Superadmin class create, update, and delete remain denied by the existing instructor-or-admin check.

`POST /api/reminders/check` stays behind admin or superadmin authentication. `dueReminderWindow` keeps the 15-minute due window. The route was not opened to a public service token. No scheduler was created in this workspace and Render was not changed. Operator setup, when authorized: store an admin or superadmin credential in the host secret store, not in git, and have that host `POST /api/reminders/check` on an interval no wider than 15 minutes. Do not add the credential to source control.

Class and reminder failures return fixed client messages: `Internal server error` and `Failed to check reminders`. The handlers no longer return `error.message`. Server logs record the event name and `failed`, not notification content or credentials.

`(userId, dedupeKey)` is still not unique. `deliverNotification` skips a recipient who already has that key, which removes the ordinary retry duplicate. Two overlapping requests can still both insert. That index stays unapplied until a duplicate analysis and a migration are approved.

## Phase 5 — enrollment concurrency

`courseId` on a new progress insert is the route id string. The enroll lookup also matches an ObjectId of the same hex so a second string row is not inserted beside an existing ObjectId row. That lookup is still check-then-insert. A compound unique index on `(userId, courseId)` treats a string and an ObjectId as different keys, so one index would not by itself stop both shapes of the same course.

No production or shared database was scanned. No duplicates were merged. The index was not created. Duplicate key 11000 still maps to 400 `{ error: "Already enrolled" }`. The in-memory concurrency test passed again. That test is not MongoDB concurrency protection.

Read-only procedure for an approved environment, not run here:

1. Group `progress` by `userId` and the raw `courseId` value and count groups with more than one document.
2. Group again by `userId` and the string form of `courseId`, and record the BSON types in each group.
3. A group whose types include both string and ObjectId is one logical course stored as two keys. A unique index created before those rows are normalized will not reject the second shape.
4. Repair requires a separate approval. This sprint does not clean or merge anything.

Migration plan, unapplied:

1. Complete the read-only scan in an approved environment and record the counts.
2. Approve a repair for any duplicate logical pairs, including mixed string and ObjectId values.
3. Create a unique index on `(userId, courseId)` only after the stored type is one type.
4. Leave the existing 11000 handler in place. A duplicate insert then returns 400.
5. Rollback is dropping that index. Dropping it restores the previous race. It does not restore deleted rows because this plan does not delete rows.

## Phase 6 — loading, navigation, and clicks

Student progress and the student dashboard show "Progress could not be loaded" and a Try again control when the request fails. An empty enrollment list remains a different state. Instructor course links render only when `canReadCourseLessons` allows that course. Notification clicks navigate only when `metadata.href` is a same-site path that starts with `/` and does not start with `//`, contain `://`, or contain a backslash. Mark-read still goes through the owned notification API. These pages were not opened in a browser.

## Phase 7 — dependencies

`npm audit` exit 1. 3 moderate, 0 high, 0 critical. `npm audit fix` was not run.

- `resend@6.13.0` remains. Lockfile dependencies are `postal-mime@2.7.4` and `standardwebhooks@1.0.0`. `node_modules/svix` and `node_modules/uuid` are absent. `npm audit` does not list `resend`, `svix`, or `uuid`.
- `postcss-selector-parser@6.1.2`, dev-only, through Tailwind 3.4.18. `GHSA-w9m9-85wc-3x92` (`>=6.1.0 <6.1.3`) would be cleared by 6.1.3. `GHSA-rj75-hqrm-r3gf` (`<7.1.6`) would not. 7.1.6 is a new major against Tailwind 3 and was not installed. The parser runs at CSS build time. Risk owner: dependency owner. Acceptance is still required.
- `quill@1.3.7` through `react-quill@2.0.0`. `GHSA-4943-9vgg-gr5r` covers `quill` `<=1.3.7`. The editor is used by `components/InstructorLessonEditor.tsx` and `components/RichTextEditor.tsx`. Student lesson HTML goes through `sanitizeForStudentView`. `npm audit fix --force` would install `react-quill@0.0.2` and was not run. Risk owner: dependency owner. Acceptance is still required.

## Phase 8 — evidence and clean build

Before the workspace `.next` directory was removed, the external pack was present, 79,220,417 bytes, and its SHA-256 matched `412B282B69B6C1B037137EA4AD850031CD0B60F891CAB0B42549F85E47D65C60`. No command in this sprint deleted that file. A second read of the external file after the final build was not completed. The build command did not take that path as an argument.

No project `node server.js` was listening, and port 3000 had no listener, before the cache was removed. The local server was not restarted.

Local environment boolean, without printing the URI: dedicated user `forexorbit_app` yes, `Damian25` no, database name `Forex_elearning` yes, scheme `mongodb+srv` yes, JWT secret present yes. That is the local file only.

`Damian25` deletion remains operator-reported. This workspace has no Atlas CLI or Atlas API key. No deletion time was supplied. `forexorbit_app` was not changed.

Final `npm run build` (`next build`, Next.js 15.5.28) exit 0. The compile phase reported success in 47 seconds. The build log contains 607 `Warning:` lines and the build continued. Node is v22.19.0. The build loaded `.env` and the URI was not printed.

The new workspace pack is a different file: 120,110,904 bytes, SHA-256 `337BF0B6142B29477F9144BB3EB1014737909B7EB0BAEE70A4EAEDB7CA7F83CB`.

Scan of that build, without printing match text: 86 scheme mentions in 6 files, 0 containing userinfo. Two unique strings, lengths 10 and 14, SHA-256 `5f37d5a9f6bf96c62e4ae0f02911ab4841ee1ab24739082100a700cb30488ffd` (43) and `d954d719505f93418ad5b3023671a30365dfa264e7e79d7a0412f3d298850457` (43). Files:

- `.next/cache/webpack/server-production/0.pack`
- `.next/server/chunks/1415.js`
- `.next/server/pages/api/auth/forgot-password.js`
- `.next/server/pages/api/auth/reset-password.js`
- `.next/server/pages/api/auth/signup.js`
- `.next/server/pages/api/auth/verify-password-otp.js`

Render was not deployed and was not restarted.

## Phase 9 — smoke tests

No isolated database, no disposable accounts, and no browser runner were available. None of the eight checks was executed. Unit tests are not these checks.

Required fixtures, created only in an approved isolated database: one active student, one inactive student, one second student, one instructor, one course, one lesson, one enrollment for the active student only, one quiz with a stored answer key, one assignment owned by the first student, and two community rooms.

| Check | Result |
| --- | --- |
| Login returns the disposable account's own identity | UNVERIFIED |
| Inactive disposable account is denied | UNVERIFIED |
| Enrolled student can read an assigned lesson | UNVERIFIED |
| Non-enrolled student is denied lesson access | UNVERIFIED |
| Student quiz responses hide answer keys | UNVERIFIED |
| A student cannot read or submit another student's assignment | UNVERIFIED |
| A community member can access only authorized rooms | UNVERIFIED |
| Socket.IO connects to that environment's own host and enforces room authorization | UNVERIFIED |

## Commands and outcomes

| Command | Exit | Result | Kind |
| --- | --- | --- | --- |
| `node --test tests/sprint-3.test.js tests/enrollment-state.test.js tests/notification-access.test.js` | 0 | 28 passed, 0 failed | In-memory and source-shape tests. No MongoDB. |
| `npm test` | 0 | 171 passed, 0 failed. Runner duration about 3.9 seconds. | Unit and in-memory tests, including Sprint 1 and Sprint 2. Run before the approval-comment wording change. |
| `node --test tests/enrollment-state.test.js tests/sprint-3.test.js` | 0 | 18 passed, 0 failed | Same in-memory tests after the approval-comment wording change. |
| `npx tsc --noEmit --incremental false --pretty false` and `node --check server.js` | 0 and 0 | No diagnostics | Typecheck and syntax. Combined duration about 57 seconds. The later production build also typechecked the final source. |
| `npx eslint` on the Sprint 3 source files listed below | 0 | 0 errors, 112 warnings | File-scoped lint. A separate full `npx next lint` was not run. The production build lint phase completed with 607 `Warning:` lines and exit 0. |
| `npm audit` | 1 | 3 moderate, 0 high, 0 critical | Advisory scan. `npm audit fix` was not run. |
| `npm run build` | 0 | Next.js 15.5.28 compiled successfully | Local production build. Not a deploy. |

The Sprint 3 eslint paths were `pages/progress.tsx`, `pages/dashboard.tsx`, `pages/instructor/dashboard.tsx`, `pages/admin/index.tsx`, `pages/api/classes/index.ts`, `pages/api/reminders/check.ts`, `pages/api/progress/all.ts`, `pages/api/admin/send-certificate.ts`, `lib/learning-level.ts`, `lib/enrollment-state.js`, `lib/account-access.js`, `lib/feature-access.js`, `lib/staff-progress.js`, `lib/class-notifications.js`, `middleware.ts`, `components/Header.tsx`, `tests/sprint-3.test.js`, and `lib/config/features.ts`.

`tests/sprint-3.test.js` covers level progress, the staff certificate decision, the staff aggregate and instructor scope, feature-flag API blocking with flags off and on, class audience and dedupe keys, the reminder window, safe notification paths, and the absence of `error.message` in the class and reminder handlers. It does not open a browser and does not write to MongoDB.

## Files changed

Added:

- `lib/feature-access.js`, `lib/feature-access.d.ts`
- `lib/staff-progress.js`, `lib/staff-progress.d.ts`
- `lib/class-notifications.js`, `lib/class-notifications.d.ts`
- `pages/api/progress/all.ts`
- `tests/sprint-3.test.js`
- this report

Updated:

- `lib/enrollment-state.js`, `lib/account-access.js`, `lib/learning-level.ts`, `lib/config/features.ts`
- `middleware.ts`, `components/Header.tsx`
- `pages/api/admin/send-certificate.ts`, `pages/api/classes/index.ts`, `pages/api/reminders/check.ts`
- `pages/progress.tsx`, `pages/dashboard.tsx`, `pages/instructor/dashboard.tsx`, `pages/admin/index.tsx`
- `package.json` test script, `tests/enrollment-state.test.js` comment
- `docs/audits/full-functional-audit/08-findings-and-remediation.md`
- `docs/audits/full-functional-audit/07-test-evidence.md`
- `docs/audits/full-functional-audit/11-sprint-2-enrollment-progress.md`
- `docs/audits/full-functional-audit/00-audit-index.md`
- `docs/audits/release-readiness-2026-10-26.md`

## Residual blockers

- `(userId, courseId)` unique index unapplied. MongoDB concurrency is not closed.
- `(userId, dedupeKey)` unique index unapplied.
- Reminder delivery has no scheduler until an operator installs one outside this workspace.
- Damian25 deletion is operator-reported and unverified.
- Render runtime identity is unverified.
- Eight smoke tests are unverified.
- Three moderate advisories have no recorded risk acceptance.
- Browser behavior of the progress page, dashboard, instructor links, and notification clicks was not executed.

## Follow-up on 26 October 2026

The code changes above were already present. This pass re-ran local verification and prepared Git locally. No production write, deploy, index, or seed was run.

`npm test` passed 171 tests, exit 0. `npx tsc --noEmit --incremental false --pretty false` and `node --check server.js` both exited 0. Sprint 3 `npx eslint --quiet` exited 0 with 0 errors. `npm audit` exited 1 with the same three moderate advisories. `npm audit fix` was not run.

A new `npm run build` was not run. A development server is listening on port 3000 and using `.next`. Its startup logged missing webpack cache files, and later `/api/auth/me` returned 200. Rebuilding into that directory would collide with the server. The Sprint 3 build and its 0-userinfo scan remain the production-build evidence. A read-only rescan of the current `.next` still found 0 userinfo matches.

Source scan found one real credential-shaped URI, in `.env`, for `forexorbit_app`. Documentation matches are placeholders and do not match that user or `Damian25`. `.env` and `.next` are gitignored.

There was no Git repository. `git init -b release-readiness/sprint-3-remediation` created that branch with no commit and no remote. Nothing was pushed. There is no diff until an approved initial commit. Do not push to `main`.

`render.yaml` is a web service only. It has no cron. Reminder scheduling stays an operator job outside this workspace. The withdrawn-enrollment policy remains accepted. Both unique indexes remain unapplied.

Compatible dependency options that were not installed:

- `postcss-selector-parser@6.1.3` is a same-major bump and would clear `GHSA-w9m9-85wc-3x92` only. `GHSA-rj75-hqrm-r3gf` continues through `7.1.5`, so `npm audit` would still report the package. `7.1.6` is a major upgrade against Tailwind 3.
- `quill` has no release above `1.3.7` that clears `GHSA-4943-9vgg-gr5r`. `npm audit fix --force` would install `react-quill@0.0.2`.

The dependency owner still has to accept those three findings or approve a separate editor and Tailwind upgrade.

## Recommendation

Proceed with blockers. Do not deploy. Do not commit or push until that approval is explicit.
