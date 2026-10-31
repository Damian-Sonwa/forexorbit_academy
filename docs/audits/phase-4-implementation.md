# Phase 4 implementation: course catalogue and content management

Branch `feat/phase-4-course-management`, based on `c2e9715`. Not committed, pushed or deployed. The findings come from `docs/audits/phase-4-course-catalogue-audit.md` (audit worktree). The H2 sanitizer fix is separate, on `fix/phase-1-3-sanitizer-regression`; this branch still contains the `c2e9715` sanitizer until the two are combined.

## Approved decisions and how they are applied

| Decision | Implementation |
|---|---|
| 1 Lifecycle | `lib/course-lifecycle.js`. States are stored in lower case (`draft`, `in_review`, `published`, `archived`), like account statuses. A course with no `status` (stored before Phase 4) is published; an unrecognised value counts as draft. Transitions go through `POST /api/courses/:id/status`. Instructors edit only drafts, while admins and the Super Admin may edit in any state. |
| 2 Deletion | `lib/course-deletion.js`, `DELETE /api/courses/:id`. Super Admin only, never a published course, and refused (`course_has_dependents`) if any protected record exists. There is no cascade beyond the course's own lessons, quizzes and unused assignments. Deletion is audited. |
| 3 Free preview | Lesson flag `isFreePreview` and course flag `freePreviewExplicit` (`isFreePreviewSlot` in `lib/course-lesson-list.js`). Explicit courses ignore position. Courses that have not been migrated keep the old first-lesson rule until the migration runs. |
| 4 Completion | `lib/course-progress.js`. Progress is measured against current lessons and capped at 100. `completedAt` is permanent, and certificates use `courseCompletion`. |
| 5 Assignment | `decideInstructorAssignee`: an active instructor account looked up in the database, checked on both create and edit. Admins and the Super Admin are not assignees. |
| 6 Media | Thumbnails stay public. Removed images are cleaned up after a reference check. See "Media" below for what is not possible in the current architecture. |
| 7 Sanitizer | DOMPurify, on the sanitizer branch. |

### Lifecycle transitions

| From → to | Allowed |
|---|---|
| draft → in_review | the assigned instructor, admin, Super Admin |
| in_review → draft | the assigned instructor (withdraw), admin, Super Admin (return for changes) |
| in_review → published | admin, Super Admin |
| published → archived | admin, Super Admin |
| archived → published | admin, Super Admin (restore) |
| draft → published, draft → archived, in_review → archived | Super Admin (override) |
| published or archived → draft or in_review | nobody: this would take a live course away from enrolled students |

Every transition is written conditionally on the state that was checked and with no deletion in progress, and each one creates an `adminAuditLog` entry.

**Deviation to approve:** the architecture has no staged-revision model, so a published course can no longer be edited by its instructor, only by an admin or the Super Admin. A proper "revise a live course" workflow (a draft copy reviewed and then swapped in) needs a separate design.

### Visibility

- The public catalogue (`GET /api/courses` with no session) and the ISR landing page show published courses only.
- A student sees published courses, plus archived courses they are actively enrolled in.
- An instructor sees published courses plus their own courses in any state.
- Admins and the Super Admin see everything.
- Draft and in-review courses return 404 to anyone else, including on outline and lesson reads.
- Enrolment and checkout (`init-course`) are for published courses only. An archived course returns 409 `course_archived`; a withdrawn student cannot re-enrol in an archived course.

## Migration

`scripts/phase-4-course-migration.js --database <name>` is read-only by default. Writing needs `--apply`, the counts from the dry run (`--expect`, so a change in the data since the dry run stops it before any write), and `--rollback-file` (the ids it changes, written first; `--rollback <file>` undoes exactly those values). Every write is conditional, so reruns change nothing. Output is counts only.

1. **status** (default): sets `status: 'published'` where the field is missing (already live courses).
2. **preview** (default): in each course without `freePreviewExplicit`, flags the lesson that was free under the old rule (`isFreePreview: true`), then sets `freePreviewExplicit: true`. An existing `isFreePreview` value is never changed.
3. **completion** (only with `--steps ...,completion`): records `completedAt` (the row's own `updatedAt`, never "now") and `completionEvidence` only where every current lesson is completed, or every completed lesson still exists. Rows whose 100% includes deleted lessons, and rows without `updatedAt`, are left unresolved.

**Production:** steps 1 and 2 were applied to `Forex_elearning` on 31 October 2026; see `docs/audits/phase-4-production-migration-2026-10-31.md`. The completion step was deliberately **not** run: every candidate row is seeded demo data, not learning activity.

## Media (Decision 6)

Uploads go only to Cloudinary, through `/api/upload/instructor` (rich-text images and instructor photos) and `/api/upload/visual-aid`. Lesson videos, PDFs and resources are links the instructor enters; the app never stores those files.

Changes made:

- Upload names are random instead of `userId_timestamp`.
- The temporary file is removed on every path, uploads are rate limited, and no email addresses are logged.
- Images removed by an edit or delete are deleted from Cloudinary only after lessons, courses and instructor profiles are checked for other references. Only this account's `forexorbit/instructors` and `forexorbit/visual-aids` folders are considered.
- **Cleanup is in report-only mode until the owner sets `MEDIA_CLEANUP=delete`.**

**Security boundary today (production inventory, 31 October 2026):**

| Media | What the app does | Access-controlled by the app? |
|---|---|---|
| 32 lesson images in 14 lessons (Cloudinary `forexorbit/instructors`, public delivery) | The URLs are sent only with lesson content that passes the read and paywall checks; they never appear in the catalogue, outline or locked lessons. | **No.** Anyone holding an image URL can open it. New uploads get random names, which makes guessing harder, but that is not access control. |
| 34 lesson videos (all YouTube links) | The link is sent only to students who may read the lesson. | **No.** YouTube serves the video to anyone with the link. |
| PDFs | none stored | n/a |
| 55 lesson resource links (outside sites) | Sent only to students who may read the lesson; unsafe schemes refused and never rendered as live links. | **No.** The outside sites decide who can open them. |
| Course thumbnails (none set) | public by decision | n/a |

Next step (design in `phase-4-final-validation.md` §4, option B): a token-checked media route for the stored lesson images, after the owner approves moving those 32 images to authenticated delivery. That move is a production storage operation and was not done.

Not done, needs a decision or design:

- **Protected delivery of private lesson media.** Sessions use a bearer token in `localStorage`, so `<img>` and `<video>` requests carry no credentials and cannot be checked server-side. Protecting stored lesson images needs either Cloudinary authenticated or signed delivery with short-lived URLs issued by the lesson read, or a cookie session. Both are storage or account changes, and existing images would also need to be moved, which is a production storage operation.
- **Videos and PDFs on third-party hosts** cannot be protected by this app. Their URLs are already withheld from the catalogue, the outline and locked lessons.
- **Images uploaded but never saved into a lesson** remain orphaned. Tracking them needs an upload registry, which means a new collection; the app's Atlas role (`lib/app-database-role.js`) does not include one.

## Rate limits

`lib/content-rate-limit.js` reuses the auth limiter: a per-process count, plus the shared MongoDB count when `SHARED_RATE_LIMIT=mongodb`; it returns 503 if the shared store fails.

- Authoring: 300 writes per account per 10 minutes.
- Uploads: 60 per account per 10 minutes.

## Not changed

- The admin "send certificate" route keeps its policy: admins and the Super Admin may issue, including without a recorded completion. Added safeguards (`lib/certificate-issue.js`):
  - inputs must be plain strings;
  - no student email in logs;
  - an `adminAuditLog` entry for every issue;
  - `completionBasis` and `completionVerified` stored on the certificate;
  - a required `reason` when completion is not verified;
  - a duplicate insert caught on both issuing routes.
  The unique `{ userId, courseId }` index is prepared (`scripts/certificate-indexes.js`; production data check: 192 certificates, 0 duplicate pairs, all ids stored as strings), but **not built**: building it is a production schema change for the owner. **Later update (31 October 2026):** built on production with owner authorisation and verified; see `phase-4-certificate-index-runbook.md`.
- Lesson HTML size is still limited only by the 16 MB request limit.
- There are no database indexes for `status`. The courses collection is small; add `{ status: 1 }` if the catalogue grows. Not built: no production index changes.
