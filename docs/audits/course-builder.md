# Course builder and learning experience redesign

- **Branch:** `feat/course-builder`, created from `7439b27` (origin/master, the deployed version).
- **Worktree:** `forexorbit_academy-course-builder`.
- **Status:** not committed, pushed or deployed.
- **Verdict:** CONDITIONALLY COMPLETE (see section H).

## A. Initial audit (what existed)

| Area | Finding |
|---|---|
| Data model | `courses` held title, description, category, difficulty, thumbnail, status and instructor. `lessons` was a flat collection with `courseId` and a course-wide `order`. There were no modules or sections. |
| Lesson content | Two separate HTML fields (`description` and `content`) stored as written by the editor and cleaned only in the browser. Alongside them: one `videoUrl`, one `pdfUrl`, and a `resources[]` list of links. |
| Uploads | Images only (Cloudinary). There was no upload for documents, PDFs or video; those were links only. |
| Editors | Four separate places wrote courses and lessons: the instructor dashboard's lesson panel, `/instructor/lessons`, `/instructor/courses/[id]`, and an inline editor on the student lesson page. The admin dashboard had a fifth course form. Each had its own form, field set and save logic. |
| Student player | The lesson page laid out video, description, a "Lesson content" card, documents, quiz and assignments in a fixed order. No builder layout existed, so nothing an instructor saw matched it exactly. |
| Preview | None. Instructors opened the student page, which showed the editor inline. |
| Saving | One editor autosaved every 30 s with no conflict detection. A later save silently overwrote another editor's work. |
| Lifecycle | Solid: draft → in_review → published → archived, enforced on the server. Instructors edit drafts only; admins edit in any state. Progress, quiz attempts and submissions refer to lesson ids. |
| Activities | One quiz per lesson (Phase 9 service). Assignments have an optional `lessonId`. Practical tasks have `courseId` and `lessonId`, but students had no way to see a task from its lesson. |

## B. Architecture

- **One stored representation.**
  - **Lessons:** the existing collection. `order` still drives progress, navigation, payments and certificates. New fields:
    - `moduleId`;
    - `blocks`, the lesson body as typed blocks;
    - `revision`, for conflict detection.
  - **Courses:** new fields:
    - `modules` (titles and order);
    - `assets` (uploaded files, at most 300);
    - optional `summary`, `objectives`, `prerequisites` and `estimatedHours`.
  - No new collections and no second copy of any content.
- **Safe content.**
  - Text is a Quill Delta: text runs plus an allowlist of formats (headings, lists, emphasis, links). It is validated on the server and rendered as React text, never as HTML.
  - Block types: heading, text, callout, image, video, file, link, example, divider.
  - Each type has defined validation, storage and rendering (`lib/course-content.js`).
- **Backward compatible.**
  - A lesson without `blocks` is shown through blocks derived from its old fields, in the old page order. Its stored HTML goes through the existing sanitizer as a `legacy` block that points at the stored field; new HTML cannot be stored.
  - In the builder, such text can be converted to editable text.
  - A course without modules is shown as one implicit module. Its first structural change turns that into "Module 1".
- **One renderer.** `components/course/` contains `LessonHeader`, `LessonBlocks`, `RichText`, `LessonActivities`, `CourseIntro` and `LessonPreview`. They are used by:
  - the student lesson page;
  - the builder's live preview of unsaved content;
  - the course preview page.
- **Order stays consistent.** Every curriculum change rewrites `order` to match modules first, then lessons within each module. Every existing reader of `order` therefore sees the builder's sequence.
- **Publishing:** the existing lifecycle, plus a server-side readiness check before review or publishing (section C). Archiving and restoring are not checked. There is still one copy of the content, so publishing changes availability only.
- **Live edits:** editing a published course changes it for enrolled students at once. Their progress, attempts, submissions, grades and certificates are kept, because they refer to lesson ids. Versioning was not needed and was not added.

## C. Builder (`/builder/[courseId]`, `/builder/new`, `/builder/[courseId]/preview`)

One workspace for instructors, admins and the Super Admin. Permissions come from the server.

- **Course creation:** a new course needs only a title. Admins choose the instructor; the server accepts only an active instructor.
- **Tabs:**
  - Curriculum & content;
  - Details: title, short and full description, category, difficulty, hours, cover image, objectives and prerequisites, autosaved;
  - Files;
  - Publish.
- **Curriculum:**
  - add, rename, reorder and delete modules;
  - add, duplicate, reorder and move lessons;
  - drag and drop, plus keyboard buttons and a "Move to" menu;
  - collapse and expand modules;
  - each lesson shows its content-type icons, reading time, free-preview mark, unsaved marker and readiness issue count.
- **Deleting:**
  - A lesson with content needs "delete" typed, and the dialog lists what is kept.
  - A module's lessons move to its neighbour; no lesson is lost.
- **Lesson editor:**
  - block editors with move, duplicate and delete, and an insert menu between blocks;
  - an Edit / Student preview switch;
  - readiness issues shown on the block concerned.
- **Uploads:**
  - **Behaviour:** drag and drop or file picker, a progress bar, cancel, retry, replace, remove, and reuse of files already uploaded to the course.
  - **Images:** the existing public image route.
  - **Documents and video:**
    - a private course file store;
    - the file's content must match its type (a renamed program is refused), the name is cleaned, and size limits apply (25 MB for documents, 100 MB for video);
    - a file still used in a lesson cannot be removed.
- **Autosave:**
  - Saves 1.2 s after the last change, one request at a time, plus a "Save now" button.
  - Shows the status and the time of the last save, and keeps a recovery copy in the browser that is offered back after a refresh.
  - Retries with backoff and warns before the author leaves with unsaved work.
- **Conflicts:**
  - A lesson save sends the revision it was based on; course details send the time they were loaded; curriculum changes send their version.
  - If someone else saved first, the server answers 409 and nothing is overwritten. The author can load the latest version or deliberately keep theirs.
- **Publishing:**
  - A status timeline and a readiness checklist; each issue links to where it can be fixed.
  - Only the lifecycle changes this member may make are offered, each with a confirmation.
  - Permanent deletion is offered to the Super Admin only.
- **Activities per lesson (existing services only):**
  - quiz editor using the Phase 9 quiz service;
  - creating assignments through the existing route;
  - linking to the existing practical-task creator, pre-filled with the course and lesson.
- **Readiness errors:**
  - missing title, description, category or difficulty;
  - no lessons;
  - an untitled module or lesson, or a lesson without content;
  - an empty media block or a missing file;
  - a quiz with no questions.
- **Readiness suggestions:** short description, cover, objectives, image description, file title, an empty module, an unpublished quiz.

## D. Student experience

- **Shared components:** the course page and the lesson page use the same `CourseIntro`, module headings and outline as the builder's previews.
- **Lessons:** the lesson page renders through `LessonBlocks` and `LessonActivities`.
- **Files and uploaded video:** delivered only through `/api/lessons/:id/document?item=b-<block>`, which re-checks enrolment, course state and the paywall, then redirects to a five-minute signed link.
- **Practical tasks:** shown on their lesson. The student task list now carries `lessonId`.
- **Unchanged:** progress, completion, payments and the paywall work exactly as before.

## E. Security

- **Builder access:**
  - Only the assigned instructor, an admin or the Super Admin may open a course in the builder. Anyone else, including other instructors, gets 404.
  - Students get 403 from every builder route.
- **Lifecycle:** instructors change content only while the course is a draft, and the server re-checks this when the write happens. Ordinary admins cannot delete courses or publish without the readiness check.
- **Block content:** validated on the server, with only http(s) or relative links. Block files must belong to the lesson's own course. Locked lessons withhold `blocks`. Course responses never include storage references.
- **Uploads:**
  - The upload route checks ownership and the edit rule before reading the file.
  - It is rate-limited, checks file content, always removes its temporary file, and stores privately (Cloudinary "private" for documents, "authenticated" for video).
- **Downloads:** a guessed or tampered link is refused.
- **Media cleanup:** it now sees images used in blocks, so they are never deleted while in use.

## F. Testing

| Check | Result |
|---|---|
| Unit and route suite (`npm test`) | 1,287 of 1,287, including 23 new builder tests. Existing tests were changed only where they pinned removed pages or link targets; each kept its guarantee by checking the new location. |
| Real-MongoDB suites (local 9.0.4 replica set) | 144 of 144 across 11 suites, including the new end-to-end route suite (create → curriculum → upload → conflicts → readiness → review → publish → student access, plus cross-user refusals) |
| Browser acceptance (`scripts/acceptance/course-builder-e2e.js`, headless Edge, real app, isolated database) | 40 of 40: all 15 required workflows, desktop 1280 px and phone 390 px |
| Preview compared with the student page | Identical block-by-block signature (type and text) for the same lesson |
| TypeScript, lint, production build | clean; 0 lint errors; passes |

## G. Engineering changes

**New code:**
- **Library:** `lib/course-content.js`, `lib/course-curriculum.js`, `lib/curriculum-ops.js`, `lib/course-asset-files.js`, `lib/course-assets.ts`, `lib/course-builder-access.ts`.
- **API routes:** `pages/api/courses/[id]/builder.ts`, `pages/api/courses/[id]/curriculum.ts`, `pages/api/courses/[id]/assets.ts`, and `pages/api/courses/[id]/asset-file.ts` (development only).
- **Pages:** `pages/builder/new.tsx`, `pages/builder/[courseId].tsx`, `pages/builder/[courseId]/preview.tsx`.
- **Components:** `components/builder/*`, `components/course/*`.
- **Tests:** `tests/course-builder.test.js`, `tests/integration/course-builder-mongo.test.js`, `scripts/acceptance/course-builder-e2e.js`.

**Changed APIs (backward compatible):**
- **Lesson create and update:** accept `blocks`, `moduleId` and `baseRevision`. Responses add `revision`.
- **Course create:** accepts `draftStart` and the new details. **Course update:** accepts the new details and `baseUpdatedAt`.
- **Status route:** checks readiness.
- **Lesson document route:** serves block items.
- **Course and outline responses:** add modules, details and `moduleId`.

**Retired:** the old editors, which removed about 2,100 net lines.
- The instructor course page and lessons page now forward to the builder.
- The dashboard's lesson panel is now a summary with "Open in course builder".
- The inline editor on the student page is gone.

**Database:**
- No migration. Existing documents work unchanged; new fields appear only when a course is edited in the builder.
- No new indexes: builder reads are bounded by `courseId` on lessons, which is already indexed by the existing queries.
- **Rollback:** older code ignores the new fields. A lesson edited in the builder would show its pre-builder fields (stale but safe) until reverted.

**Storage:** new private folder `forexorbit/course-files` in the existing Cloudinary account. No provider was called in testing; local storage is used and is disabled in production.

## H. Remaining limitations

1. **Cloudinary limits:** uploads of documents and video in production depend on the Cloudinary plan. The free plan caps raw files at 10 MB and video at 100 MB, so a 25 MB PDF may be refused on that plan. Not tested against the real account, by design.
2. **Video streaming:** uploaded video uses signed "authenticated" delivery links, which are streamable but do not expire, unlike document links. The access check still runs on every page load.
3. **Quiz preview:** shows the questions with the answer key (the existing staff view), not an interactive practice attempt.
4. **Duplicating:** copies content only. Quizzes, assignments and tasks stay with the original lesson, and earlier pre-builder text must be converted first.
5. **No real-time co-editing:** concurrent edits are detected and refused, not merged.
6. **Dead code:** some unused editor code remains in the instructor and admin dashboards; a cleanup can follow.
7. **Old HTML content:** existing lessons keep their HTML until someone converts them in the builder. Course descriptions remain HTML, cleaned at display as before.
8. **Production tests:** none were run. Browser verification used an isolated local database.

## I. Git status

- **Branch:** `feat/course-builder`.
- **Started from:** `7439b27`.
- **Commits:** none.
- **Working tree:** 35 modified or deleted files and 20 new paths.
- **Not done:** nothing has been committed, pushed, merged or deployed.
