# Phase 12: Instructor portal and academic operations

Branch `feat/phase-12-instructor-portal`, from `7e24484` (origin/master, Phase 11 live). Not committed.

## 1. Audit (before changes)

| Area | State found | Action |
|---|---|---|
| Account status | Enforced: withAuth reads the live account; anything but `approved` is refused (suspended sessions no longer authenticate). Suspend/reactivate is Super Admin only, reasoned, audited, and ends sessions | Reused, tested |
| Approval | Super Admin only (lib/account-approval.js) | Unchanged, tested |
| Course ownership | `ownsCourse` / `isAssignedInstructor` on every course, lesson, assignment and grading route | Reused as the portal scope |
| Reassignment | Only as a side effect of an admin's course edit: **no audit, no notification, no conflict protection** | Dedicated audited endpoint; the editor path now uses it |
| Grading | Solid (Phase 9): authority, validation, atomic history, points, concurrency (409), notification | Added: reason for changing a grade, audit entry, notification dedupe |
| Assignments | No publish/close state; **edit validation weak** (invalid date stored, unbounded points, points changeable after grading) | Status draft/published/closed; validated edits; points locked once graded |
| Instructor UI | Dashboard and course management only; grading per assignment page; **no student list, no grading queue, no activity history, no profile view** | Built the portal areas |
| Profile | Shared `/profile` (name, phone, photo) for all users; no instructor-specific fields exist | Reused; portal shows account, status and assigned courses (no invented fields) |
| Indexes | Submissions by assignment had no serving index (A2 starts with userId) | A7 added (definition only) |

## 2. API

| Route | Who | Purpose |
|---|---|---|
| GET /api/instructor/overview | instructor, admin, Super Admin | Teaching metrics, per-course figures, recent activity |
| GET /api/instructor/students | " | Paginated students of scoped courses (filters: course, status, name) |
| GET /api/instructor/students/:id | " | One student's records in scoped courses (404 otherwise) |
| GET /api/instructor/submissions | " | Grading queue: pending (oldest first), late, graded, all |
| GET /api/instructor/submissions/:id | " | Full work, brief and grade history for review (404 outside scope) |
| GET /api/instructor/activity | " | Own grade actions and course moves (audit log) |
| GET /api/instructor/profile | " | Own account and assigned courses |
| GET/POST /api/admin/courses/:id/reassign | admin, Super Admin | Assignment history; audited reassignment |

All the portal routes are private (no-store) and rate-limited (`instructor-portal-read`, 600 per 10 minutes). Instructors are scoped to their own courses; admins see all courses, as ownsCourse already allowed. Students are shown by name and level only: no email or phone.

## 3. Rules

- **Grades:** an integer from 0 to 100, with feedback of up to 5,000 characters, as before.
  - Changing an existing grade needs a reason of 5–500 characters. Re-saving the same grade with new feedback needs none.
  - The submission's history entry gains `reason` and `version`.
  - The audit log (append-only) gets an entry with id `grade:<submissionId>:<version>`. It records:
    - actor, student, course and assignment;
    - previous and new grade, and the reason;
    - time and outcome.
  - `gradeAuditPending` is set atomically with the grade and cleared once the entry exists. The activity route repairs any interrupted entry from the history.
  - Notifications carry a `dedupeKey` per grade version.
  - Quiz scores (`quizAttempts`, `quizScores`) are never touched by grading.
- **Assignments:** status is `draft`, `published` or `closed`. Records with no status stay published, as before.
  - Drafts are hidden from students: list, read and submit return 404.
  - Closed assignments stay visible, refuse new work with 409 and can still be graded.
  - Edits are validated: title up to 200 characters, instructions up to 10,000, a valid due date, and points as a whole number from 0 to 1,000.
  - Points cannot change once any submission is graded (409). Edits never touch submissions or grades.
- **Reassignment:**
  - Admins and the Super Admin only; a reason is required; the target must be an approved instructor; the same instructor gets 409.
  - One conditional update of `courses.instructorId`, plus `instructorHistory`, on the instructor that was read. A concurrent change gets 409 and never applies.
  - Audited (`entityType: 'course'`) and both instructors are notified (deduplicated).
  - Enrollments, progress, quiz attempts and scores, assignments, submissions and grades are keyed by course, lesson and student, so they are untouched. Course and lesson ids never change.
  - Access follows the owner on the next request.
- **Metric definitions:** in the header of lib/instructor-portal.js (completion rate, average progress, active learners, pending/late/graded, quiz pass rate).

## 4. Database impact

No new collection, and no change for existing data to work. New optional fields:
- `assignments.status`;
- `assignmentSubmissions.gradeAuditPending`;
- `gradeHistory[].reason` and `gradeHistory[].version`;
- `courses.instructorHistory` and `courses.instructorAssignedAt`.

Every collection is already in the app role. **Index A7** (`assignmentSubmissions {assignmentId, status, submittedAt}`) is defined but **not built**. It needs approval to build. The existing narrowed indexer role already covers `assignmentSubmissions`. Until it's built, queue reads use a collection scan, which is acceptable at the current size.

## 5. Limitations

- Instructor activity reads the audit log by actor, which has no index (it's small; an index on `actor.userId, createdAt` is recommended if it grows).
- Student lists filter by name in memory over a course's enrollments, which is fine at the current scale.
- Browser verification was not performed.
