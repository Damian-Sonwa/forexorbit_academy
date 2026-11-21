# Practical trading tasks and assessment system

Branch `feat/practical-trading-tasks`, from `d1bd4a2` (origin/master, Phase 12 live). Worktree `forexorbit_academy-practical-tasks`. Not committed. Independent of the uncommitted Phase 13 branch.

## 1. Audit of the existing system

| Area | Found | Decision |
|---|---|---|
| `demoTasks` | Free-form title, description and instructions. `assignedTo` is one student or null, meaning every student on the platform. No course, no rubric, no status, no deadline enforcement. | Extended in place with schema `practical_v2`. Older tasks are untouched. |
| `demoTaskSubmissions` | One row per student, overwritten on resubmission. Free-text reasoning and public screenshot URLs. A grade of 0-100 or a letter. | Reused. Practical attempts are separate documents with `_id pt:<task>:<student>:<n>`, never overwritten. |
| Task API | Instructors and admins could create a task for all students with no course scope. Any instructor could list every task. | Older routes kept, and they now skip practical tasks. New scoped API added. |
| Grading | Instructor types a number. No rubric, no history, no audit. | Rubric engine plus audited instructor grading. |
| Simulator (Phase 10) | Server-authoritative orders and positions, with `plannedRisk` and the order type on the order. | Read only, as the evidence source. The engine is unchanged. |
| Trade reviews | Link a review to a task through `taskIsFor`. | `taskIsFor` now understands practical tasks: recipient, and published or closed. |
| Uploads | Journal screenshots go to public Cloudinary URLs. | Practical evidence uses Cloudinary `private` delivery, served only through a short-lived signed link after a permission check. |
| Database role | Per-collection custom role in Atlas. | No new collection, so no Atlas change is needed. |
| AI task hint | Read any task by id, with no assignment check. | A practical task is hinted only to its recipients or scoped staff. |

## 2. Model

**`demoTasks` (practical_v2) fields:**
- title, summary, instructions, objectives;
- category and competency, difficulty, instruments;
- requirements: side, order types, trade range, maximum risk %, minimum reward-to-risk, explanation length, external policy, attachments, simulator;
- rubric (version, criteria, maxScore), gradingMode, maxAttempts, dueAt;
- courseId, lessonId, resources;
- ownerId, plus assignedBy and `assignedTo: 'practical_v2'`;
- status (draft, published, closed or archived), version and version history, recipients, generator settings.

**Attempt (in `demoTaskSubmissions`) fields:**
- status (in_progress, submitted, awaiting_grading, awaiting_review, graded or returned) and revision;
- frozen copies of the rubric, requirements, grading mode and maximum attempts, taken when the attempt starts;
- draft, attachments (private public ids), frozen evidence, evidencePositionIds;
- autoResult, grade, gradeHistory.

## 3. Lifecycle

**Task:** draft, then published, then closed (it can reopen while its deadline is in the future), then archived. An unpublished draft can be discarded.

**Distribution:**
- Only students actively enrolled in the task's course can receive it: the whole course, or a selection.
- Distribution is additive and idempotent.
- Only new recipients are notified, with the dedupe key `practical-task:<id>`.

**Attempt:**
1. Start. A double click is safe because the `_id` is unique.
2. Work. Progress auto-saves.
3. Submit. The server freezes the evidence.
4. Automatic mode is graded immediately. Assisted and manual modes are queued.
5. The instructor publishes the grade, or returns the work.

Returned work grants one more attempt, until the later of the deadline and 72 hours after the return. While attempts remain and the deadline hasn't passed, a student can make another attempt after a grade. The latest graded attempt counts.

**Deadlines, closure and attempt limits** are all enforced on the server.

## 4. Grading

**Modes:**
- **Automatic** is the default when no mode is chosen. It needs every criterion to be system-checked, and it can't be used when external evidence is required.
- **System-assisted:** the engine scores the checkable criteria. The instructor reviews, can adjust a score with a reason, and publishes. The instructor is the final authority.
- **Manual:** the instructor scores every criterion.

**Policy freezing:**
- Each attempt copies the rubric and mode when it starts.
- After attempts exist, changing the rubric, requirements, mode or attempt limit needs `confirmPolicyChange` and a reason. The change is audited and applies to new attempts only.

**Engine (`lib/practical-grading.js` 1.0.0):**
- Pure and deterministic: no clock, no randomness.
- Prices and money use BigInt.
- Each criterion scores points × (passing trades / trades), rounded down.
- It returns per-criterion status and detail, strengths, recommendations, observations, and a fingerprint of the inputs.
- Profit is only scored by `net_result_positive`, which must be added deliberately.
- A losing trade with sound process scores the same as a winning one, and a test checks this.

**Checks:**
- trades opened inside the window;
- trade count;
- instrument, direction and order type;
- stop on the protective side;
- target set;
- minimum reward-to-risk;
- planned risk at or below the limit, against each trade's own account starting balance;
- trade closed;
- explanation length (length only; quality is never machine-judged).

**Integrity of the evidence:**
- Position ids are loaded together with the student's own user id.
- Each trade must have been opened between the attempt's start and the submission.
- A trade already used in another submitted attempt is refused.
- Order type and the original stop and target come from the order. The starting balance comes from the account.
- Facts typed by the client are never used.

**Instructor grading:**
- Optimistic concurrency on `revision`: a stale grader gets 409.
- Every criterion must be scored, from 0 to its maximum points.
- Changing a published grade, or overriding a system grade, needs a reason.
- Every action is added to `gradeHistory`.
- Every action is audited: `practical_grade_published`, `practical_grade_changed`, `practical_returned` and `practical_auto_graded`.

## 5. External evidence

- **Files:** PNG, JPEG or WebP up to 8 MB. The declared type must match the file's first bytes.
- **Storage:** private Cloudinary delivery. The app route checks permission, then redirects to a signed link that expires after 5 minutes. No public URL is stored.
- **Who can open a file:** only the attempt's student, or staff over the task's course. Everyone else gets 404.
- **Trade figures:** stored as entered and marked `verified: false`. No OCR, and no broker access or credentials.
- **Grading:** external evidence is only ever judged by an instructor.

## 6. API (`/api/practical-tasks`)

Every route goes through withAuth with the live account check, returns private no-store responses, and is rate-limited per account using the existing limiters.

| Route | Purpose |
|---|---|
| `GET/POST /` | List tasks; create a task |
| `POST /generate` | Generate a task from a template |
| `POST /preview` | Validate a definition without saving |
| `GET /summary` | Instructor figures |
| `GET /queue` | Grading queue |
| `GET/PUT/DELETE /:id` | Read, edit, or discard a draft |
| `POST /:id/publish` | Publish or assign more students |
| `POST /:id/status` | Close, reopen or archive |
| `POST/PUT /:id/attempt` | Start an attempt; save work in progress |
| `POST/DELETE /:id/evidence` | Upload or remove a screenshot |
| `POST /:id/submit` | Submit |
| `GET /evidence` | Open an evidence file |
| `GET/POST /attempts/:attemptId` | Grading workspace; grade |

**Roles:**
- **Students:** only their own tasks and attempts.
- **Instructors:** courses in their teaching scope. A reassigned course takes its tasks with it.
- **Admins and the Super Admin:** read-only oversight. No authoring or grading, so no privileges were added.

## 7. Database impact

- **Collections and role:** no new collection, and no change to the app role or Atlas.
- **Indexes:** none added.
  - Attempts use the existing T15 (task, student) and T16 (student, recent) indexes.
  - Student task lists scan `demoTasks` filtered by `recipients`, which is bounded by the number of tasks.
  - If the number of tasks grows large, `{ schema: 1, recipients: 1, status: 1 }` is the index to add, with approval.
- **Account deletion:** a deleted student's attempts are deleted (existing behaviour), and they are now also removed from `recipients`. Their private evidence images stay in Cloudinary with no app record pointing to them; a storage clean-up job is a follow-up.

## 8. Limitations

- **Linking trades:** the order ticket doesn't tag trades with a task. Trades are linked at submission by time window and ownership, which needed no change to the Phase 10 engine.
- **OCR and broker connections:** none. External evidence is human-reviewed only.
- **Consistency:** writes use conditional updates rather than transactions. A grading step interrupted by a crash is completed on the next read (`finishPending`).
- **Browser check:** layouts were checked in headless Edge at 360 and 390 px with service-generated data. They haven't been tried with a live session.
