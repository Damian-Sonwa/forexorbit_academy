# Phase 9: Quizzes, Assessments and Grading

**Branch:** `feat/phase-9-assessments`, based on Phase 8 commit `e78ce9b`.
**Worktree:** `C:\Users\Juliet\Downloads\forexorbit_academy-phase-9-assessments`
**State:** closed by a local milestone commit (section 17.1). Not pushed, merged or deployed. No production database or configuration was touched.
**Date:** 4 November 2026 (work started 1 November and was interrupted by a usage limit).

---

## 1. Executive summary

**Verdict: code complete and verified locally, ready for owner review. Production rollout is a separate step that has not started and has not been approved (section 16.4).**

The server now owns the whole assessment lifecycle: who may attempt, how many times, the deadline, the saved answers, the score, the result and when answers may be reviewed. The browser only displays what the server decides.

- **Before Phase 9** a quiz was a single request. There were no server-side attempts, timers, limits or publication states, students received every question up front, and regrading an assignment paid its points again.
- **The critical defect** found in the first version of this work is fixed: an attempt could end up permanently submitted with no score. Finishing an attempt is now a recoverable workflow, proven by failure injection at every step on real MongoDB.
- **35 findings** are recorded in section 2: 32 resolved, 1 partially resolved (P9-22) and 2 outstanding (the production rollout in P9-14 and the baseline test flakes in P9-29).
- **Two gaps were larger than the audit expected.** No page let a student submit an assignment or an instructor grade one, and the instructor quiz page could load with no courses at all. Both are fixed.

| Gate | Result |
|---|---|
| Full test suite (`npm test`) | **939/939** (859 before this phase, plus 80 new) |
| Dedicated Phase 9 suite | **80/80** |
| Real MongoDB, Phase 9 | **32/32** |
| Real MongoDB, payments, enrollment, progress | 4/4, 3/3, 3/3 |
| Real MongoDB, rate limits | **Intermittent** (11/12 or 12/12); same failures on clean `e78ce9b`, cause explained in P9-29 |
| Browser e2e, Phase 9 | **80/80** |
| Browser e2e, Phases 6, 7, 8 | **42/42, 73/73, 30/30** |
| TypeScript | 0 errors |
| ESLint, whole repository | 0 errors, 674 warnings (636 at `e78ce9b`; 43 added, 5 removed, section 14.6) |
| Production build | Passes |
| Secret scan, whitespace check | Clean |

**What must happen before release** is in section 16: indexes A1-A6, the application role update, and Phase 8's L8 and L9. Phase 8 must not be released on its own if production uses `forexorbitAppRole` (P9-14).

**The three product questions** raised in review were decided by the owner on 4 November 2026 and are applied (section 16.2).

---

## 2. Original Phase 9 objectives and scope

**Objective from the brief:** protect assessment integrity and make the server authoritative for assessment rules, attempt state, timers, submissions, scoring and grades.

The original brief was recovered from session transcript `dd82fa62`. Its section 14 tests and section 17 gates, plus the owner's prompt of 4 November, are the acceptance criteria.

**In scope:** question management, quiz publication, attempt lifecycle, randomization, scoring, manual grading, results and review, security, indexes, and student and instructor experience.

**Out of scope, respected:** Phase 10 practice trading and Phase 11 dashboards. Authentication, payments, enrollment, lesson delivery and progress behaviour are unchanged, except for the integration fixes named below.

### 2.1 Approved policies (owner, 4 November 2026)

| # | Policy | Where enforced |
|---|---|---|
| 1 | Single-answer questions only | `normalizeQuestions` |
| 2 | No partial credit | `scoreAttempt` |
| 3 | Legacy quizzes keep their publication status; none is auto-published | `legacyStatus`, quiz `PUT` |
| 4 | Legacy quizzes keep unlimited attempts | `LEGACY_SETTINGS` |
| 5 | Submission has a 10-second grace period | `SUBMIT_GRACE_SECONDS`, `attemptOverdue` |
| 6 | Late assignments are accepted and flagged | `isLate`, submit route |
| 7 | Failed quizzes do not complete lessons | `attemptCompletesLesson` |
| 8 | Timed-out attempts with zero answers do not complete lessons | `attemptCompletesLesson` |
| 8a | **Submitted** attempts with zero answers do not complete lessons, even with no pass mark. With no pass mark, an attempt with at least one answer does. | `attemptCompletesLesson` |
| 9 | Resubmission preserves grading history | submit route, `previousVersions`, `gradeHistory` |
| 10 | Manual grading applies to assignments | The brief does not require manual quiz questions, so none were added |
| 11 | The quiz leaderboard is the average of every attempt in a final scored state, submitted or timed out, retakes included, and the UI says so. Unresolved or abandoned attempts do not count until finalized and scored. | `pages/api/leaderboard/index.ts`, `pages/leaderboard.tsx`, `components/Quiz.tsx` |
| 12 | Reconciliation stays manual; no scheduler in this phase | `scripts/quiz-attempt-reconcile.js`, section 16.2 |

### 2.2 Leaderboard decision

**Rule (owner decision, 4 November 2026):** a student's quiz score on the leaderboard is the average of every attempt in a final scored state, submitted or timed out, one `quizScores` row each. Retakes count, so a lower retake lowers the average. Reconciliation cannot add a duplicate, because a score row's `_id` is its attempt's `_id`.

**History:** the brief contains no ranking rule, and the earlier session's first-results-only change had no basis in it, so it was removed. The owner then confirmed the average of all results.

**Timed-out attempts count once scored,** as the owner confirmed. **Unresolved attempts do not count.** The leaderboard reads only `quizScores`, and a row is written only after an attempt is finalized and scored. So an attempt in progress, an overdue attempt nothing has settled yet, and an interrupted attempt with no score row are all absent until reconciliation scores them, then count once. Cancelled attempts never count. Proven on real MongoDB through the real route.

**Where students see it:** `/leaderboard` explains the rule on the Quizzes tab, the count column is labelled Attempts (it was labelled Quizzes, P9-33), and each quiz's instructions say every attempt counts.

### 2.3 Findings register

Severity: Critical, High, Medium, Low. Tests are in `tests/phase-9-assessments.test.js` (unit), `tests/integration/assessments-phase9-mongo.test.js` (mongo) and `scripts/acceptance/assessments-e2e.js` (e2e).

| ID | Sev. | Original defect and impact | Fix | Files | Proving tests | Status |
|---|---|---|---|---|---|---|
| P9-01 | High | No server attempts, limits, deadlines or publication state. Attempts were unlimited and nothing was timed. | Attempt service with atomic reservation, frozen snapshots and terminal states | `lib/quiz-attempts.js`, `lib/quiz-assessment.js`, attempts routes | unit "limits", "start", "publication"; mongo limit tests | Resolved |
| P9-02 | High | Students received every question before starting, so a timed quiz could be read before its clock ran. | Students get a summary only; questions arrive with an attempt | `pages/api/quizzes/[lessonId].ts`, `lib/course-lesson-list.js` | unit "correct answers"; e2e `api` | Resolved |
| P9-03 | **Critical** | An attempt could become permanently submitted with no score if the score write failed. A retry said "already final", so score and lesson completion were lost for good. | Recoverable workflow (section 7) | `lib/quiz-attempts.js`, `scripts/quiz-attempt-reconcile.js` | unit "recovery" (5 steps, 4 entry points); mongo "failure at" (5 steps) | Resolved |
| P9-04 | Medium | `startAttempt` could return a 500: a parallel request could write the reserved attempt first, and the reserving request's insert then hit a duplicate key. Never a duplicate attempt. | Duplicate key returns the stored attempt | `lib/quiz-attempts.js` | unit and mongo "insert gap" | Resolved (section 5.3) |
| P9-05 | High | Reads expired attempts at the deadline while submit allowed 10 more seconds, so a read in that window discarded unsaved answers. | One rule, `attemptOverdue`, for every path | `lib/quiz-assessment.js`, `lib/quiz-attempts.js` | unit "grace" (2 tests, 5 paths); mongo "expiry" | Resolved |
| P9-06 | High | A timeout with no answers completed the lesson when the quiz had no pass mark. | `attemptCompletesLesson` | `lib/quiz-assessment.js` | unit and mongo "timed-out", "completion" | Resolved |
| P9-07 | High | A legacy graded submission that was resubmitted and regraded paid its points twice. | Stored grades count whatever the status; the award is written down at resubmission | `lib/assignment-grading.js`, submit route | unit "legacy submissions" | Resolved |
| P9-08 | High | Each regrade added the full points again (route at `e78ce9b`). | Only the difference moves (`pointsAwarded`) | grade route | unit "regrading"; mongo "regrade" | Resolved |
| P9-09 | High | Points are a second write. An interruption lost the award, and a blind retry could pay twice. | `pointsPending` with an idempotency key on the user | `lib/assignment-grading.js`, grade and submit routes | unit "points recovery" (3 tests); mongo "interrupted award" | Resolved |
| P9-10 | Medium | A grade could land on work the grader never read, and a concurrent grade could be overwritten. | Conditional on `gradeVersion` and `submittedAt`; a conflict is a 409 | grade route | unit "two graders", "a grade applies only"; mongo "concurrent grading" | Resolved |
| P9-11 | Medium | Staff results stopped at 200 and the summary described only those rows. | Pagination; summary aggregated over all attempts | `quizResults`, attempts route, `QuizResultsPanel.tsx` | unit "results"; mongo "beyond 200"; e2e `results` | Resolved |
| P9-12 | Medium | No history across quizzes. | `GET /api/quizzes/history`, on `/progress` | `pages/api/quizzes/history.ts`, `AssessmentHistory.tsx` | unit "history"; mongo; e2e `history` | Resolved |
| P9-13 | Medium | Deleting a lesson stranded attempts in progress forever. | `closeLessonAttempts`: open attempts become `cancelled`, results stay | `lib/quiz-attempts.js`, lesson route, `lib/course-deletion.js` | unit "lesson deletion" (2 tests) | Resolved |
| P9-14 | High | `learningDays` and `learningMinutes` are missing from `forexorbitAppRole` at `e78ce9b`, and the role test could not see them. With that role, activity writes and the summary would fail. | Role and stronger test (code). **Production role update pending.** | `lib/app-database-role.js`, `tests/app-database-role.test.js` | `app-database-role.test.js`; unit "permissions" | Code resolved; **rollout outstanding** |
| P9-15 | High | No UI existed to create, submit or grade assignments, or to show a student their grade. Feedback could not reach students. | Student panel, instructor panel, grading form on the existing API | `LessonAssignments.tsx`, `LessonAssignmentsPanel.tsx`, `SubmissionGradeForm.tsx`, analytics page and route | e2e `grading`, `assignment` | Resolved |
| P9-16 | High | `/instructor/quizzes` copied the course list once, before it loaded, so the page could stay empty and the editor unreachable. Found by e2e. | Effect follows `courses` | `pages/instructor/quizzes.tsx` | e2e `instructor` | Resolved |
| P9-17 | Medium | At zero the client only read the attempt, so answers not yet autosaved were lost. | The client submits inside the grace period | `components/Quiz.tsx` | e2e `timer` | Resolved |
| P9-18 | Medium | The settings form wrote UTC into a local-time field, so open and close times shifted on every save. | `toLocal` uses the local offset | `QuizSettingsPanel.tsx` | Code review only; see section 16.3 | Resolved |
| P9-19 | Low | `/progress` would show `66.67/3`, and old rows showed 0%. | Presenter uses `correct`; count hidden when unknown | `lib/enrollment-state.js`, `pages/progress.tsx` | unit "scores"; e2e `history` | Resolved |
| P9-20 | Medium | Saving a legacy quiz from an editor without settings could publish it. | Saves merge over `quizSettings(existing)`; explicit markers are honoured | `lib/quiz-assessment.js`, quiz route | unit "legacy quizzes" | Resolved |
| P9-21 | Medium | A plain unique index on `quizScores.attemptId` would fail on every old row, which has no `attemptId`. | A5 is partial | `lib/assessment-indexes.js` | unit "indexes"; mongo index tests | Resolved |
| P9-22 | Medium | Student reads loaded answer keys into server memory. | Attempt and overview reads project the key out. `readLessonDetail` still loads it and strips it. | `lib/quiz-attempts.js` | unit and mongo "never load" | **Partially resolved** (never sent; section 16.1) |
| P9-23 | Medium | No rate limits on assignment writes or quiz saves. | Existing limiters applied | quiz and assignment routes | unit "rate limits" | Resolved |
| P9-24 | Medium | The leaderboard rule had been changed with no basis in the brief. | Restored, then confirmed by the owner | `pages/api/leaderboard/index.ts` | unit "leaderboard"; mongo "leaderboard"; e2e `leaderboard` | Resolved |
| P9-25 | Low | The grading page was 999 px wide on a phone. It first passed a weak check, which is now strict. | `min-w-0`; the form sits outside the scrolling table | analytics page | e2e `mobile` | Resolved |
| P9-26 | Low | A 0 grade showed as ungraded; N+1 lookups in assignment lists and analytics. | Fixed and batched | assignment routes | unit "regrading"; `assignment-access.test.js` | Resolved |
| P9-27 | High (test) | A `String.replace` `$'` pattern corrupted the shared test helper, so four suites would not load. | Repaired; helper gained `$type`, `skip`, real sort, array-aware `$ne`, `deleteOne` | `tests/helpers/payment-memory-db.js` | The four files, 90/90 | Resolved |
| P9-28 | Medium (test) | `secure-sessions` pinned a date and began failing after 2 November. **Baseline**: fails at clean `e78ce9b`. | One test-only argument; no authentication code changed | `tests/secure-sessions.test.js` | 38/38; full suite also passes with the clock 30 days ahead | Resolved |
| P9-29 | Low (test) | `test:mongo` is intermittent: "four instances" gives `9 !== 10`, and the TTL test gives `0 !== 1`. **Baseline**: both occur on clean `e78ce9b`. | Causes measured (section 14.3); both are test assumptions, not lost counts. No rate-limit code or test changed. | `tests/integration/rate-limit-mongo.test.js` | Section 14.3 | **Outstanding** (explained) |
| P9-30 | Medium | A failure while releasing the slot left the counter pointing at a finished attempt, so the student got `attempt_busy` permanently. | A finished attempt never keeps the slot | `lib/quiz-attempts.js` | unit "stale open slot" | Resolved |
| P9-31 | Medium | Parallel first submissions could create two rows and pay twice. | A2, a duplicate becomes a resubmission, recoverable award | submit route | unit and mongo "parallel first submissions" | Resolved (full guarantee needs A2 in production) |
| P9-32 | Medium | A submitted attempt with no answers completed the lesson when the quiz had no pass mark, and also with a pass mark of 0. | `attemptCompletesLesson` requires at least one answer; the page warns before submitting and explains the result | `lib/quiz-assessment.js`, `components/Quiz.tsx`, `QuizSettingsPanel.tsx` | unit and mongo "completion"; e2e `empty` | Resolved |
| P9-33 | Low | The leaderboard column labelled Quizzes counts attempts, which would contradict the stated rule. | Labelled Attempts; rule stated on the page | `pages/leaderboard.tsx` | unit "the rules are told"; e2e `leaderboard` | Resolved |
| P9-34 | Medium | **Baseline defect:** every quiz leaderboard row showed "Unknown". The lookup passed string ids to a query on ObjectId `_id`s. Found by the new e2e check. | `objectIdsFrom`, as the course tab already does | `pages/api/leaderboard/index.ts` | mongo "leaderboard"; e2e `leaderboard` | Resolved |
| P9-35 | Low | **Baseline defect, reproduced at runtime before the fix:** a certificate issued by the real route showed as "Unknown" on the Completions tab, for the same reason as P9-34. | `objectIdsFrom`, which also covers older ObjectId rows. Authorized by the owner. | `pages/api/leaderboard/index.ts` | mongo "Completions tab"; e2e `leaderboard` | Resolved |

---

## 3. Architecture and server-authoritative design

```
Browser (components/Quiz.tsx)      shows state, sends answers, nothing else
        │
Routes (pages/api/quizzes/...)     session, CSRF, Origin, rate limit, no-store
        │
lib/quiz-attempts.js               access, lifecycle, reconciliation (database)
        │
lib/quiz-assessment.js             rules: validation, scoring, review (pure)
        │
MongoDB                            quizzes, quizAttempts, quizAttemptCounters, quizScores
```

| Decision | Who decides | Never trusted from the client |
|---|---|---|
| May this student attempt? | `loadQuizContext` (enrollment, course state, prerequisite, paywall) | user ids, roles |
| Is the quiz available? | `quizAvailability` | status, dates |
| How many attempts? | Atomic counter | attempt numbers |
| When does it end? | `attemptDeadline`, `attemptOverdue` | deadlines, clocks |
| What is the score? | `scoreAttempt` on the frozen questions | scores, percentages, pass flags |
| Is review allowed? | `reviewAllowed` | anything |

The client's only timing role is display. It corrects for device clock skew using `serverNow`. The e2e suite proves this with the device clock set an hour behind.

---

## 4. Assessment and question management

**Question type:** single-answer multiple choice, 2-8 options (two covers true/false). Up to 100 questions per quiz, 1-100 points each (default 1), with an optional explanation.

**Server validation** refuses: an empty list, blank or overlong text, blank or duplicate options, a correct answer that is out of range or not a single whole number, and invalid points. Question ids stay stable across edits, so history remains meaningful.

**Settings:** `status`, `maxAttempts` (1-20 or unlimited), `timeLimitMinutes` (1-300 or none), `passingPercent` (0-100 or none), `reviewPolicy`, `shuffleQuestions`, `shuffleOptions`, `availableFrom`, `availableUntil`.

**Publication:** a draft does not exist for students on any route (404). Each save increments `version`.

**Existing Phase 4 rule, unchanged:** instructors edit only draft courses. On a published course only admins can change a quiz, including its draft or published state. The instructor sees the server's refusal (e2e confirmed).

**Snapshots:** starting an attempt freezes its questions, option order, correct option and points. Later edits never affect it, and the stored result can be recomputed from the attempt alone (unit "snapshots").

**Randomization:** done once on the server when the attempt starts, then persisted. A refresh returns the same order, and the answer key is remapped with the shuffle.

---

## 5. Attempt lifecycle and concurrency

### 5.1 States

```
                 ┌─> submitted   (submit before deadline + grace)
in_progress ─────┼─> expired     (deadline + grace passed; graded on saved answers)
                 └─> cancelled   (lesson deleted; no result, no score)
```

Terminal states are final. Every transition is a conditional update on `status: 'in_progress'`, so only one request can finish an attempt.

### 5.2 Creation

`quizAttemptCounters` holds one document per student and quiz (`_id` `"<userId>:<lessonId>"`) with `count` and `openAttemptId`. Reserving a number and the single open slot is one atomic upsert on a unique `_id`, conditional on no open attempt and on the limit. So the limit holds even before any Phase 9 index exists, and even if the read before it is stale (mongo test "enforced by the atomic reservation itself").

A refresh, second tab or retry resumes the open attempt. A reservation whose attempt was never written is completed by the next request, so it does not cost the student an attempt.

### 5.3 Investigation of the unguarded insert (owner item B)

Tested on real MongoDB 9.0.4.

- **Duplicate attempts: not possible.** The reservation prevents them. 15 rounds of 40 simultaneous starts each produced exactly one attempt.
- **Unexpected 500s: real but narrow.** With the fix removed, the 40-way stress did not trigger it. It occurs when one request is held between reserving and inserting while another completes, which the forced-gap test reproduces on the real server.
- **Fix:** a duplicate key on insert returns the stored attempt. Under extreme contention a request can receive `409 attempt_busy`, which the UI shows as a message; nothing is corrupted.

---

## 6. Timers, expiration and autosave

**One rule:** `attemptOverdue(attempt, now)` is true once `now >= deadlineAt + 10 s`. Read, overview, autosave, submit and start all use it.

| Time | Read | Autosave | Submit |
|---|---|---|---|
| Before the deadline | open | accepted | counted |
| Deadline to +10 s | open | accepted | **all answers counted** |
| From +10 s | expires | 409 | expires; answers in the request ignored |

- **Deadline:** start time plus the limit, capped by `availableUntil`. Untimed attempts have none.
- **Recorded end:** an expired attempt's `submittedAt` is its deadline.
- **Client at zero:** the page submits automatically inside the grace period. If that cannot reach the server, it asks again after 12 seconds, by which time the server has decided.
- **Abandoned attempts:** settled by any later request, when staff open results, or by the sweep.
- **Autosave:** one answer per request, only for this attempt's questions and real options; `null` clears. The page shows saved and not-yet-saved states and retries when back online.

---

## 7. Submission, idempotency and recovery

**Transactions are not used.** The application uses none anywhere and the local server is standalone, so they could not be tested here. The owner's prompt allows a recoverable workflow where transactions are unavailable.

### 7.1 Quiz workflow

1. One atomic update stores the terminal status, answers, result and `effectsPending: true`.
2. `reconcileAttempt` applies each effect, all idempotent:
   - releases the open slot;
   - inserts the score row, with `_id` equal to the attempt's `_id`, so a second row is impossible even without A5;
   - records lesson completion with `$addToSet`, if earned and the lesson is still open.
3. Only then is `effectsPending` cleared.

If any step fails, the flag stays set and the caller gets a 500, never a result.

**Recovery runs from:** a repeated submit, reading the attempt, the quiz overview, starting again, a late autosave, and `scripts/quiz-attempt-reconcile.js` for students who never return. Concurrent reconciliation is safe (25 at once on real MongoDB, one row).

**Idempotency:** repeated or concurrent submits return the stored result. Different answers in a repeat are ignored.

### 7.2 Quizzes award no points

Neither the old route nor this phase awards user points for quizzes, so quiz retries cannot pay twice. Assignment points are in section 9.

---

## 8. Scoring, grading and lesson completion

**Rules**
- A question is all or nothing. Unanswered and invalid answers score 0.
- `percent = round(earned / available x 100, 2 decimals)`.
- Pass when `percent >= passingPercent`, compared on the stored percentage. No pass mark means `passed` is null.
- Earned marks can never exceed available marks.

**Examples**

| Questions (points) | Correct | Result |
|---|---|---|
| 1, 1, 2 | first only | 1 of 4 = 25% |
| 1, 1, 1 | two | 66.67% |
| 1, 1, 1, pass mark 67 | two | Not passed (66.67 < 67) |
| 1, 1, 1, 1, pass mark 50 | two | Passed |
| 1, 1, 2 | none answered | 0% |

**Lesson completion**

| Outcome | No pass mark | Passed | Failed |
|---|---|---|---|
| Submitted with answers | Completes | Completes | Does not |
| Timed out with answers | Completes | Completes | Does not |
| Submitted, no answers | **Does not** | **Does not** (pass mark 0) | Does not |
| Timed out, no answers | **Does not** | **Does not** (pass mark 0) | Does not |

An attempt with no answers never completes a lesson, on any route. With no pass mark, one answer is enough, even a wrong one. Completion also requires the lesson to be open to the student (Phase 6). Attempts with no answers still record a 0% result, and those results count on the leaderboard.

**Review policies:** `after_submission`, `after_pass`, `after_last_attempt`, `never`. Tested on every route, including the legacy one-step route. With unlimited attempts, `after_last_attempt` never releases the key.

**Leaderboard:** section 2.2.

---

## 9. Assignment integration and grade history

**Who may grade:** the course instructor, admins and the Super Admin. Other instructors and students are refused, and nobody grades their own work.

**Values:** grades 0-100, feedback up to 5000 characters.

**Recorded:** every grade is appended to `gradeHistory` with grade, feedback, grader, time, previous grade and points.

**Points:** a first submission pays the assignment's participation points (existing behaviour). A grade pays `round(grade% x points)`, and a regrade moves only the difference, up or down.

**Resubmission:** the earlier work, grade and feedback move to `previousVersions`, the current grade clears, `gradeHistory` is untouched, and `pointsAwarded` records what was already paid. The student is told this before resubmitting.

**Legacy data:** any stored grade counts as paid, including submissions where an old resubmission set the status back to `submitted`.

**Recoverable points.** Points cross two documents, so:
1. The write that changes the submission also stores `pointsPending: { key, delta }`.
2. `settlePendingPoints` updates the user only if the key is not already listed, and lists it in the same atomic write.
3. The pending field is cleared, then the key is removed.

A crash at any point can be retried and pays exactly once (20 concurrent retries on real MongoDB). A later grade, resubmission or the sweep finishes it.

**Notifications:** the student gets a `task_feedback` notification. A failed notification never undoes a grade.

**Late work:** accepted and flagged to student and grader. A date with no time means the whole day.

---

## 10. Student and instructor UI

**Student (lesson page, `/progress` and `/leaderboard`):** instructions, a note that every attempt counts toward the leaderboard average, a warning before submitting nothing, start and resume, question navigator with answered markers, autosave state, server-synchronized countdown, confirmation that counts unanswered questions, passed, failed and expired results, policy-controlled review, attempt history, cross-quiz history, assignment submission, grade and feedback. Loading, empty and error states are present. A submission is never shown as successful until the server confirms it.

**Instructor (`/instructor/quizzes`):** create and edit questions, settings and publication, paged results, review of an attempt against its frozen questions, a lesson's assignments and a link to grading.

**Grading (`/instructor/assignments/analytics/:id`):** the student's work, late flag, grade and feedback form, grading history.

**New components:** `AssessmentHistory`, `LessonAssignments`, `instructor/LessonAssignmentsPanel`, `instructor/SubmissionGradeForm`.

**Why these went beyond the original list:** the brief requires feedback delivery and a grading workflow, and no UI existed for either (P9-15). They use the existing API only.

**Older editors:** `pages/instructor/dashboard.tsx` and `pages/instructor/courses/[courseId].tsx` still edit questions without the settings panel. Their saves keep existing settings, question ids, points and explanations.

---

## 11. Authorization and security review

| Area | Result | Evidence |
|---|---|---|
| Session identity | The session is the only identity; `userId` in a body or query is ignored | unit "ownership", "scoring"; e2e `api` |
| Attempt ownership / IDOR | Every student lookup includes the session's user and the lesson; others get 404 | unit "ownership"; e2e `api` |
| Course scoping | Other instructors get 403 on results, review, quiz and grading | unit "authorization"; e2e `access` |
| Role separation | Students reach no staff operation; staff cannot take or submit quizzes | unit "authorization" |
| Enrollment and paywall | Enforced on every route, including mid-attempt withdrawal | unit "access" |
| Answer leakage | Absent from summaries, attempts, lesson payloads, history and logs before review | unit "correct answers"; e2e `api`, `leakage` |
| In-progress privacy | Staff cannot open an attempt in progress | unit "review" |
| CSRF and Origin | Existing `withAuth` checks; refused on live routes | unit "security"; e2e `api` |
| Rate limiting | `assessmentLimiter` on attempts and submissions, `authoringLimiter` on quiz and assignment authoring and grading | unit "rate limits" |
| Caching | `no-store` on all private responses | unit "security" |
| NoSQL injection | Ids are type- and format-checked; `questionId` must belong to the attempt; dotted paths use validated ids only; page values are whole numbers | unit "security", "autosave" |
| Race conditions | Conditional updates, unique ids, version checks | mongo suite |
| Duplicate awards | Idempotency key on the user | unit and mongo |
| Timer manipulation | Nothing in a request reaches a deadline; device clock tested | unit "timer"; e2e `timer` |
| Error handling | Fixed public messages; injected failures leak no detail | unit "recovery" |

**Mutation check.** 21 safeguards were broken one at a time, in memory only, and each was caught. Removed safeguards included ownership, the limit check and filter, the grace period, the zero-answer rule, the key guard and the score id. See section 14.2.

---

## 12. Database collections, indexes and permissions

### 12.1 Collections and fields

| Collection | Change |
|---|---|
| `quizAttempts` | New. Frozen questions, answers, result, status, `effectsPending` while finishing |
| `quizAttemptCounters` | New. `_id` `"<userId>:<lessonId>"`, `count`, `openAttemptId` |
| `quizzes` | Adds `settings`, `version`, `updatedBy`; question `id`, `points`, `explanation` |
| `quizScores` | New rows add `attemptId`, `attemptNumber`, `percentage`, `correct`, `earned`, `available`, `passed`, `status`. Old rows untouched. |
| `assignmentSubmissions` | Adds `late`, `gradedAt`, `gradeHistory`, `gradeVersion`, `pointsAwarded`, `previousVersions`, `pointsPending` while settling |
| `users` | Adds `pointAwardKeys`, normally empty |

No migration is needed. All new fields are optional, and legacy rows are read safely.

### 12.2 Indexes

| ID | Collection | Name | Definition | Duplicate check |
|---|---|---|---|---|
| A1 | `quizAttempts` | `quiz_attempt_user_lesson_number` | `{ userId: 1, lessonId: 1, number: 1 }` unique | Yes |
| A2 | `assignmentSubmissions` | `assignment_submission_user_assignment` | `{ userId: 1, assignmentId: 1 }` unique | **Yes, may find real duplicates** |
| A3 | `quizAttempts` | `quiz_attempt_lesson_results` | `{ lessonId: 1, status: 1, submittedAt: -1 }` | n/a |
| A4 | `quizzes` | `quiz_lesson` | `{ lessonId: 1 }` unique | **Yes, may find real duplicates** |
| A5 | `quizScores` | `quiz_score_attempt` | `{ attemptId: 1 }` unique, partial `{ attemptId: { $type: 'string' } }` | Yes |
| A6 | `quizScores` | `quiz_score_user_recent` | `{ userId: 1, createdAt: -1 }` | n/a |

**Script:** `node scripts/assessment-indexes.js --database <name>` is read-only and creates neither indexes nor collections. `--apply` builds what is missing. It refuses while any unique index would meet duplicates or an index conflicts, never drops an index, never touches a document, and is idempotent. All of this is tested on real MongoDB.

**Integrity does not depend on A1 or A5.** The counter and the score `_id` already guarantee them. A2 and A4 close races that exist today.

### 12.3 Phase 8 requirements

- `learningDays` and `learningMinutes` are now in the role (P9-14).
- L8 and L9 are built by `node scripts/learning-indexes.js --database <name> --apply`. They are not built in production. Their script passes on real MongoDB (`test:mongo:progress`, 3/3).

### 12.4 Application role

`forexorbitAppRole` gains read and write on `quizAttempts`, `quizAttemptCounters`, `learningDays` and `learningMinutes`. `quizzes`, `quizScores`, `assignments`, `assignmentSubmissions` and `users` were already covered. `tests/app-database-role.test.js` now detects `COLLECTIONS.x` member expressions, the blind spot behind P9-14, and fails if a used collection is missing.

---

## 13. Performance and query optimization

| Path | Result |
|---|---|
| Quiz overview | Fixed query count; key not loaded; attempts exclude questions |
| Attempt start | Reads the quiz once; atomic reservation |
| Staff results | One page, one aggregation, one batched name lookup; plan uses A3 |
| Student history | One page, one count, two batched title lookups (tested); plan uses A6 |
| Attempt list | Plan uses A1 |
| Assignment list | One submissions query (was one per assignment) |
| Assignment analytics | One user lookup (was one per submission) |

**Remaining limits**
- Assignment analytics loads every submission of an assignment. This is acceptable at current scale but has no pagination.
- A student's per-quiz attempt list is unpaginated. It is bounded by `maxAttempts`, except on unlimited quizzes.
- The sweep scans `quizAttempts` and `assignmentSubmissions` without a dedicated index. It is an occasional operator task.
- Staff results settle at most 50 overdue attempts per read; the rest follow on later reads or the sweep.
- The leaderboard aggregates all of `quizScores` per request (unchanged).

---

## 14. Automated and regression test coverage

### 14.1 Results (final code)

| Suite | Command | Result |
|---|---|---|
| All unit and route tests | `npm test` | **939/939**, 0 skipped |
| Phase 9 | `npm run test:assessments` | **80/80** |
| Real MongoDB, Phase 9 | `npm run test:mongo:assessments` | **32/32** |
| Real MongoDB, payments | `npm run test:mongo:payments` | 4/4 |
| Real MongoDB, enrollment | `npm run test:mongo:enrollment` | 3/3 |
| Real MongoDB, progress | `npm run test:mongo:progress` | 3/3 |
| Real MongoDB, rate limits | `npm run test:mongo` | 11/12 or 12/12, see 14.3 |
| Clock moved 30 days ahead | `npm test` | 939/939 (no other date-dependent tests) |

**Target for real MongoDB tests:** local server 127.0.0.1, MongoDB 9.0.4, standalone. Before use I confirmed no production-named database existed there and that the test database did not yet exist. It holds no collections after the runs. Failure injection wraps the real driver, so those tests are real database tests with one call made to throw.

### 14.2 Mutation check

Each safeguard was broken in memory at load time, with no file changed, and the suites run.

- **Result:** 24 safeguards, all caught, including restoring empty-submit completion, dropping timed-out attempts from the leaderboard, and first-result ranking.
- **Honest note:** the first run's "attempt limit filter" result was not valid. It was caught by an unrelated test, at the moment a route file was being edited. I added a dedicated test (a stale read at the limit) and reran all the Mongo mutants with nothing else changing. They were then caught by the right tests.

### 14.3 Failure classification

| Failure | Class | Evidence |
|---|---|---|
| `tests/secure-sessions.test.js` date | **Pre-existing baseline**, fixed test-only | Failed at `e78ce9b`; passes with the clock at 2 November |
| `rate-limit-mongo` "four instances" `9 !== 10` | **Pre-existing baseline**, intermittent, explained below | Fails on this branch and on clean `e78ce9b` (2 of 4 runs). The test uses `lib/shared-rate-limit` and `lib/auth-rate-limit`, which Phase 9 did not change. |
| `rate-limit-mongo` TTL `0 !== 1` | **Pre-existing baseline**, intermittent, explained below | Failed 1 of 4 runs on clean `e78ce9b`; reproduced on demand |
| `parallel first submissions` in two mutant runs | Not reproduced | 18 isolated runs passed (10 under CPU load) and every clean suite run passed. The first coincided with a route edit. The second was under an unrelated mutant, cause unconfirmed. |
| Phase 9 regressions | **None open** | P9-16 and P9-25 were found by e2e and fixed |

**Why the rate-limit tests are intermittent** (measured on an isolated test database; no rate-limit code or test changed).

*"Four instances" (`9 !== 10`).* Each login increments three independent counters: `login-ip` (max 30), `login-email-ip` (max 10) and `login-email` (max 50). The test sends 32 requests, so two exceed `login-ip`. A request that took a first-10 `login-email-ip` slot and was also refused by `login-ip` uses up that slot without being allowed, leaving 9 or 8. The test assumes this never happens.

**Observed directly:** a scratch trace ran the real `consumeSharedLimit` in 4 processes on a fresh database, recording each request's three decisions (the trace re-creates the short loop in `consume`, which is not exported per rule). Over 100 rounds, 78 allowed 10, 16 allowed 9 and 6 allowed 8. All 22 short rounds were fully accounted for by slots spent on requests `login-ip` refused.

| Setup, 40 rounds each | Allowed | Status codes | Final count |
|---|---|---|---|
| Database dropped first, 32 requests | 10 in 35 rounds, 9 in 2, 8 in 3 | 200 and 429 only | 32 every time |
| Database dropped first, 28 requests | 10 every time | 200 and 429 only | 28 every time |
| Collection created first, 32 requests | 10 every time | 200 and 429 only | 32 every time |

**Also observed:** it needs more than 30 requests and a collection that does not exist yet (table above, plus 30 further rounds with the collection present, all 10). There were no 503s and the final counts were exact, so no count was lost.

**Inferred, not observed:** *why* a new collection matters. The likely reason is that the first writes stall while the collection is created, which pushes the three counters out of step, but no per-operation timing was captured.

**Effect:** the limiter errs strict. Under a burst it can admit slightly fewer than 10, never more. It needs over 30 simultaneous logins from one address on a brand-new collection, so the real-world effect should be negligible (a judgement, not a measurement).

*TTL (`0 !== 1`).* **Observed:** windows are aligned to the wall clock every 10 minutes, this server's `ttlMonitorSleepSecs` is 60, not the 1 second the test's comment assumes, and the test failed with `0 !== 1` when started 25 seconds before a boundary and passed when started inside a window (one run each). **Inferred:** the "kept" row expires during the wait and is correctly deleted.

*Suggested later, test-only:* create the collection before the workers start and use 30 or fewer requests, and start the TTL test away from a boundary.

### 14.4 Existing tests changed

Four tests changed because Phase 9 deliberately changed what students receive: they now assert a summary instead of questions (`quiz-access`, `course-lesson-list`, `phase-4-course-management`, `phase-7-learning-experience`). `app-database-role.test.js` was strengthened. No assertion was weakened and no test skipped.

### 14.5 Diff review

- `tests/helpers/payment-memory-db.js`: the corruption is gone. Every remaining change is a behaviour real MongoDB has and these tests need: dotted paths, `findOneAndUpdate`, `deleteOne`, `skip`, real `sort`, array-aware `$ne` and `$type`.
- Phase 4-8 tests: only the contract updates in 14.4, the role test and the one-argument `secure-sessions` fix.
- Production files from earlier phases touched, each for a named finding: `lib/account-access.js`, `lib/course-deletion.js`, `lib/course-lesson-list.js`, `lib/enrollment-state.js`, `lib/app-database-role.js`, `lib/content-rate-limit.js`, `pages/api/lessons/[id].ts`, `pages/api/leaderboard/index.ts`, `pages/progress.tsx`, `pages/courses/[id]/lessons/[lessonId].tsx`, `scripts/seed-dev.js`.
- No line-ending churn; whitespace check clean.

### 14.6 Lint

Compared per file with clean `e78ce9b`, with caching off: 636 warnings before, 674 now, 0 errors in both. **Added 43:** `lib/quiz-attempts.d.ts` 17, `lib/quiz-assessment.d.ts` 15, `lib/quiz-attempts.js` 7, and one each in `lib/course-lesson-list.js`, `pages/api/assignments/[id]/submit.ts`, `lib/assignment-grading.d.ts` and `lib/assignment-grading.js`. **Removed 5:** `components/Quiz.tsx` 3, `pages/instructor/quizzes.tsx` 2. The new warnings are mainly `no-explicit-any` in declaration files and `no-require-imports`, plus one `no-unused-vars` at `lib/quiz-attempts.js:179`, all kinds already common in the repository; none is an error.

### 14.7 Brief section 14 coverage

| Group | Status |
|---|---|
| Assessment and question security | Covered: unit, e2e |
| Attempt integrity | Covered: unit, real MongoDB, e2e |
| Scoring | Covered: unit, real MongoDB |
| Randomization and persistence | Covered: unit, e2e |
| Manual grading | Covered: unit, real MongoDB, e2e |
| Student results | Covered: unit, e2e |
| Regression, Phases 6, 7, 8 | Covered: suites above |
| Lesson completion, empty submissions | Covered: unit, real MongoDB, e2e |
| Leaderboard rule | Covered: unit, real MongoDB (real route), e2e |

---

## 15. Browser E2E and mobile verification

**Tooling:** the existing harness (real `server.js`, real MongoDB, headless Microsoft Edge over DevTools) with the same guard. Database: `forexorbit_phase5_assessments_acceptance`. No new framework.

**Results, on the final code:** Phase 9 **80/80**. Phase 6 **42/42**, Phase 7 **73/73**, Phase 8 **30/30**.

**Phase 9 coverage** (`scripts/acceptance/assessments-e2e.js`)
- **Direct API on the live server:** no session, foreign Origin, missing CSRF, key absence, drafts, other students' attempts, other instructors, 20 parallel starts, 12 parallel submits.
- **Access:** signed-out and wrong-role redirects.
- **Student:** instructions, start, navigator, autosave, offline and recovery, refresh and resume, confirmation, an unconfirmed submit shown as not submitted, passed, failed, attempts used up, history, review policy `never`.
- **Timer:** a real one-minute attempt with the device clock an hour behind, refresh keeps the deadline, automatic submit at zero, abandoned attempt.
- **Instructor:** server refusal of blank options, draft, settings, publish keeping ids and version, published-course refusal, results paging, attempt review.
- **Grading:** late flag, grade, history, exact points, notification, feedback to the student, resubmission.
- **Empty submissions:** warning before submitting, explanation on the result, no completion, then a retake with one wrong answer completes the lesson.
- **Leaderboard:** the rule is shown, the student's row shows their name and the average of all 6 attempts, and the Completions tab names students.
- **Leakage:** no fixture email or answer key text in the server log.

**Mobile at 390 px:** instructions, attempt, confirmation, result and review, `/progress`, `/leaderboard`, instructor editor and grading page all fit (wide tables scroll inside their own container), with quiz controls at least 44 px tall. The check requires the viewport to stay 390 px wide. An earlier, weaker check passed the grading page while it was really 999 px wide (P9-25).

**Not covered by a browser:** Firefox, Safari and real phones. The phone is Edge at 390 px.

---

## 16. Outstanding limitations, rollout requirements and operational risks

### 16.1 Known limitations

- `readLessonDetail` still loads quiz answer keys on the server for students before stripping them (P9-22). They are never sent.
- Review policy is read when reviewing, so changing it later changes what is shown for old attempts.
- Students with `after_submission` review and attempts remaining can see the key and then retake. This is the policy's meaning. Those retakes count on the leaderboard, by the approved rule.
- With no pass mark, a single answer, even a wrong one, completes a lesson (approved).
- An attempt with no answers still counts as a 0% result on the leaderboard.
- Assignment submission in the UI is text only. The API also accepts a file link.
- Instructors cannot unpublish a quiz on a published course themselves (Phase 4 rule); an admin must.
- In-progress attempts are not in `/progress` history; they show on the lesson.
- During a database outage, reading an interrupted attempt returns a 500 until reconciliation succeeds. This is deliberate, so nothing unconfirmed is shown.
- Points paid twice by the old regrade bug before Phase 9 cannot be identified or corrected.
- A student with both string and older ObjectId certificate rows would appear as two rows on the Completions tab. `scripts/certificate-indexes.js` reports non-string ids.
- `assessmentLimiter` and `authoringLimiter` count per server process unless `SHARED_RATE_LIMIT=mongodb` is set. That is existing behaviour.
- `decideQuizSubmit` in `lib/account-access.js` is no longer used by production code. It is left in place because tests cover it.
- The 12-second recheck after time-up is a client convenience; the server remains the authority.

### 16.2 Owner decisions (4 November 2026)

1. **Quiz leaderboard:** the average of every attempt in a final scored state, submitted or timed out, stated in the UI. Unresolved attempts wait for reconciliation. Applied (section 2.2).
2. **Empty submissions:** an attempt with no answers does not complete the lesson. Applied (section 8).
3. **Reconciliation:** stays a manual script, safe to run by hand. No scheduler was added or deployed.
4. **P9-35:** fix authorized if reproduced. It was reproduced and fixed.

**Future operational improvement:** run `node scripts/quiz-attempt-reconcile.js --database <name> --apply` on a schedule. Until then, interrupted or abandoned work settles when the student returns, when staff open results, or when an operator runs the script. The script is idempotent, so a schedule could be added later without code changes.

### 16.2a Compatibility

- **API change:** students no longer get `questions` from `GET /api/quizzes/:lessonId` or the lesson payload; they get a summary. Any client other than this web app that reads questions there will break.
- **Tabs open during deploy:** a page still running the old bundle cannot show questions for a quiz until it reloads.
- **One-step `POST /api/quizzes/:lessonId`** remains for older clients. Timed or shuffled quizzes answer `409 start_required`, and attempt limits now apply to it.
- **Legacy results:** old `quizScores` rows stay in averages and history, with no pass or fail recorded.
- **New quizzes from the two older editors** take the legacy defaults: published, unlimited attempts, no time limit.

### 16.3 Outstanding manual verification

- Real phones, Firefox and Safari.
- P9-18 (settings time zone) has no automated test. Please save a quiz with an opening time once and confirm it does not shift.
- Everything in section 16.4, on production.

### 16.4 Rollout sequence

Phases 7, 8 and 9 are all unreleased (`origin/master` is `0935557`), so they ship together.

1. Review and commit Phase 9.
2. Take a database backup.
3. **Read-only checks on production:**
   - `node scripts/assessment-indexes.js --database <name>`
   - `node scripts/learning-indexes.js --database <name>`
   - `node scripts/check-db-role.js --database <name>`, if production uses `forexorbitAppRole`
4. **Resolve any duplicates reported for A2 or A4** by hand. The script never merges or deletes.
5. **Update the role** before the new code runs: read and write on `quizAttempts`, `quizAttemptCounters`, `learningDays`, `learningMinutes` (`docs/audits/production-database-runbook-indexes-and-role.md`).
6. **Build indexes** with `--apply`: A1-A6, then L8 and L9. A1 and A3 need `quizAttempts`; the script handles a collection that does not exist yet.
7. Deploy.
8. Smoke test: one student quiz, one timed quiz, one grade, one instructor results page.
9. Run `node scripts/quiz-attempt-reconcile.js --database <name>` (read-only). Expect zero or a small number.

**Order matters:** the role must come before the deploy, or attempt writes fail. Indexes can follow the deploy if needed, because integrity does not depend on A1 or A5, but A2 and A4 then stay open until they are built.

### 16.5 Rollback

- **Code:** returning to the previous release is safe for data. New collections are ignored and new fields are additive.
- **After rollback:** attempts in progress are abandoned. Old code again pays regrades in full, and students again receive questions up front. Old code knows nothing of `settings`, so **draft quizzes become visible** and limits, timers and review policies stop applying. Check for draft quizzes before rolling back.
- **Score rows** written by Phase 9 remain readable by old code, because `score` is a percentage in both.
- **Indexes** can stay. A2 and A4 enforce what the old code assumes. A5 is harmless. Dropping them is optional.
- **Before rolling back:** run the reconcile script with `--apply`, so pending effects are finished.

### 16.6 Operational risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Role not updated before deploy | Medium | Step 5; `check-db-role.js` |
| Duplicates block A2 or A4 | Unknown until step 3 | Read-only report first |
| Interrupted effects build up | Low | Self-healing on return; run the script by hand after incidents and at release |
| Parallel first submissions before A2 exists | Low | Build A2 at rollout |
| `test:mongo` flakiness hides a real failure | Low | Causes are known; test-only fix suggested (P9-29) |
| Draft quizzes exposed by a rollback | Low | Check before rolling back (16.5) |

---

## 17. Final acceptance checklist and completion status

| Requirement | Status |
|---|---|
| Test helper repaired, four files load | ✅ |
| Baseline recorded (858/859, one pre-existing failure) | ✅ |
| `tests/phase-9-assessments.test.js` and npm commands | ✅ 80 tests |
| A. Submission and score reconciliation | ✅ Failure injection at each step, unit and real MongoDB |
| Unique `quizScores.attemptId` with duplicate check | ✅ A5, partial |
| B. Concurrent attempt creation, real MongoDB | ✅ Section 5.3 |
| C. Timer and expiry consistency | ✅ |
| D. Zero-answer timeout | ✅ |
| Zero-answer submission | ✅ |
| E. Assignment regrading and points | ✅ |
| F. Results pagination, history, lesson deletion | ✅ |
| Ten approved policies applied and documented | ✅ Section 2.1 |
| Leaderboard rule decided, shown in the UI, tested | ✅ Section 2.2 |
| Completions tab defect reproduced and fixed | ✅ P9-35 |
| Reconciliation manual, scheduling documented as future work | ✅ Section 16.2 |
| Indexes reviewed, idempotent, read-only by default | ✅ |
| Application role coverage | ✅ Code. Production update pending. |
| Phase 8 role, L8, L9 accounted for | ✅ Code. Production pending. |
| Student and instructor UI | ✅ |
| 390 px and desktop | ✅ Edge only |
| Real MongoDB suite | ✅ 32/32 |
| Browser e2e, Phases 6-9 | ✅ |
| `secure-sessions` | ✅ Test-only fix |
| Full quality gates | ✅ Except intermittent baseline `test:mongo`, now explained (P9-29) |
| Security and performance review | ✅ Sections 11, 13; one partial (P9-22) |
| Report | ✅ This document |
| Production indexes, role, deploy | ⛔ **Not done, by instruction** |

**Code readiness:** complete. **Production rollout:** not started and not approved; it needs the owner's separate approval and the steps in section 16.4.

### 17.1 Phase 9 completion record

**Status:** closed on 4 November 2026 by local commit `feat: complete phase 9 assessments`, whose parent is `e78ce9b`, on branch `feat/phase-9-assessments`. A commit cannot contain its own hash; find it with `git log --grep="feat: complete phase 9 assessments"`.

**Production deployment has not been authorized or performed.** The commit is local: not pushed, not merged. No production database, role, index or configuration was changed.

**Main implementation areas**
- Server-authoritative quiz attempts: limits, deadlines, frozen question snapshots, randomization, autosave and scoring.
- Recoverable finishing of attempts and assignment point awards, with a manual reconciliation script.
- Publication, availability and answer review policies.
- Assignment grading, regrading and resubmission history, with student and instructor UI.
- Staff results with pagination and attempt review, student history across quizzes.
- Indexes A1-A6, application role coverage and leaderboard name fixes.

**Final test results:** `npm test` 939/939, also with the clock 30 days ahead. Phase 9 suite 80/80. Real MongoDB: Phase 9 32/32, payments 4/4, enrollment 3/3, progress 3/3. Browser e2e: Phase 9 80/80, Phase 6 42/42, Phase 7 73/73, Phase 8 30/30. TypeScript 0 errors. Production build passes. Secret scan clean. All ran on the source committed here; only this report changed afterwards.

**Baseline rate-limit limitation:** `npm run test:mongo` fails intermittently, on clean `e78ce9b` as well (P9-29, section 14.3). Not a Phase 9 regression; no rate-limit code was changed.

**Lint:** 0 errors, 674 warnings; 636 at `e78ce9b`, 43 added, 5 removed (section 14.6).

**Remaining compatibility limitations:** section 16.2a. Students no longer receive `questions` from the quiz or lesson reads, tabs open during a deploy must reload, and the two older quiz editors have no settings panel.

**P9-22, partially resolved:** the lesson route still loads answer keys into server memory for students before stripping them. They are never sent.

**Required before production** (section 16.4):
1. Back up the database.
2. Run the read-only checks: `scripts/assessment-indexes.js`, `scripts/learning-indexes.js` and `scripts/check-db-role.js`, each with `--database <name>`.
3. Resolve any duplicates reported for A2 or A4 by hand.
4. Update `forexorbitAppRole` before deploying: `quizAttempts`, `quizAttemptCounters`, `learningDays`, `learningMinutes`.
5. Build A1-A6 and L8, L9 with `--apply`.
6. Deploy Phases 7, 8 and 9 together, smoke test, then run `scripts/quiz-attempt-reconcile.js` read-only.

Phase 8 must not ship alone if production uses `forexorbitAppRole` (P9-14).

**Next:** Phase 10, Practice Trading Environment (Master Engineering Roadmap). Not started.
