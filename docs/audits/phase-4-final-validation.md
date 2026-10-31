# Phase 4 final validation and outstanding design work

Date: 31 October 2026. Nothing was committed, staged, pushed, merged or deployed. No production data, storage, settings or files were changed.

> **Later update (31 October 2026):** the owner then authorised the Phase 4 migration (steps `status` and `preview`), and it was applied to production after the script was corrected. The completion step was not run, because the evidence shows all 48 rows at 100% are seed data. See `phase-4-production-migration-2026-10-31.md`. Statements below that the migration had not been run describe the state when this report was written.

## 1. Worktree state

| Worktree | Branch | HEAD | Staged | Working tree |
|---|---|---|---|---|
| `forexorbit_academy-sanitizer-fix` | `fix/phase-1-3-sanitizer-regression` | `c2e9715` | 0 | 4 modified (`lib/html-sanitizer.ts`, `package.json`, `package-lock.json`, `tests/browser-hardening.test.js`), 2 new (DOM test, record) |
| `forexorbit_academy-phase-4-implementation` | `feat/phase-4-course-management` | `c2e9715` | 0 | 43 modified (+940 / −613), 22 new files from the implementation, plus this report |
| `forexorbit_academy-phase-4-audit` | `audit/phase-4-course-catalogue` | `c2e9715` | 0 | audit report only; SHA-256 `9c52408c…00dd6`, unchanged |
| `forexorbit_academy-phase-1-3-remediation` | `fix/phase-1-3-security-remediation` | `c2e9715` | 0 | clean |
| original `forexorbit_academy-master` | `review/sprint-1-3-integration` | `ce445d1` | 0 | the same 5 pre-existing user changes |
| other worktrees (`forexorbit-review`, `forexorbit-ui-review`, email-reset, h3) | unchanged | | 0 | unchanged since the start |

**Combined-branch check.** A scratch copy of the Phase 4 branch with the sanitizer changes overlaid was built outside Git; neither worktree was touched.

- Tests: 692/692 (648 − 2 retired + 7 sanitizer + 39 Phase 4)
- TypeScript: 0 errors
- Production build: passes

The two branches combine without conflicts, apart from `package.json` and `package-lock.json`, which need merging: Phase 4 changes the test list, and the sanitizer branch adds `dompurify` and `jsdom`.

## 2. Migration review (`scripts/phase-4-course-migration.js`)

### Code review

| Check | Result |
|---|---|
| Default run makes no writes | Yes. Without `--apply`, only `countDocuments` and `find` are called. Verified against production behind a proxy that throws on any write method; no write was attempted. |
| `--apply` required for writes | Yes. |
| Idempotent | Yes. Every write is conditional (`$exists: false`), and the second simulated run changed nothing (below). |
| Interrupted run | Safe to rerun. Each step only acts on records still missing their field. A course whose preview step stopped partway can, at worst, get its old free lesson flagged a second time; there is no other effect. Diagnosis: rerun read-only and the remaining counts show what is left. |
| Existing courses hidden or turned into drafts | No. Only courses with no `status` are touched, and they become `published`. The application already treats them as published. |
| Progress and certificates | Never deleted or lowered by the migration. It only adds `completedAt`, and certificates are not touched. |
| Lesson order | Not changed by the migration. Duplicate orders are tolerated: the old free lesson is chosen by `(order, _id)`, the same tie-break the app used. |

### Production read-only run (`Forex_elearning`, counts only)

The `.env` in the original folder points at the production Atlas cluster. Its configured name `Forex_elearning_dev` does not exist there; the only database visible is `Forex_elearning`.

| Step | Read-only result |
|---|---|
| status | 6 courses without status → would become `published` |
| preview | 6 courses to migrate, 6 lessons to flag (one per course), 0 already set |
| completion | 48 rows at ≥100% without `completedAt`: **25 would be recorded**, **23 need review** |

### Data notes (counts only)

- **Courses:** 6, all with an active instructor as owner, all with lessons, no unsafe thumbnails.
- **Lessons:** 34. None has a duplicate or missing order, a tied first position, `isFirstLesson`/`isDemo`/`isFreePreview` set, or an unsafe video, PDF or resource URL.
  - **3 lessons have no course.** Their course was deleted under the old hard delete. The migration leaves them alone; deletion is a decision for the owner.
- **Progress:** 110 rows, all active.
  - **45 contain lessons that no longer exist.**
  - None is stored above 100.
  - Under the new rule: 25 complete by current lessons, 23 unverified, 62 not complete.
- **The 23 unverified rows:** all are at 4 of 5 current lessons, across 4 courses. They reached 100% by counting a lesson that was later deleted, and a new lesson has been added since. 8 of these students already hold a certificate, which is kept. **15 have no certificate** and, under the new rule, need to complete the new lesson, or the owner can decide to honour the old 100%.
- **Certificates:** 192 total, no duplicate student/course pairs.
  - **159 belong to courses that no longer exist** (old hard deletes). They are kept and nothing changes them.
  - Of the 33 for existing courses, 8 would not count as complete under the new rule. They stay valid: Decision 4 never revokes issued certificates.

### Simulated `--apply`

The simulation ran on an in-memory copy of non-personal fields only: no user ids, names or emails. It was never persisted and is **not** a restored database.

| | First apply | Second apply |
|---|---|---|
| status updated | 6 | 0 |
| previews flagged | 6 | 0 |
| completion recorded | 25 (23 need review) | 0 (the same 23 still need review) |
| data changed by second run | | **none** |

- Published catalogue count: 6 before, 6 after. No course hidden, no draft created.
- Courses whose free lesson changed for a student without the course: **0**.
- Stored progress values and completed-lesson history: **unchanged**.

### Owner decision: the 23 unverified rows

The migration leaves them untouched. However, the next time a lesson is added to or deleted from one of those 4 courses, Phase 4 recalculates their progress to 80%; the old value is kept in `legacyProgress`. Before deploying, choose one of:

- (a) accept this: the student completes the new lesson;
- (b) record `completedAt` for these 23, honouring the old completion;
- (c) review each case.

### Restored-copy test

**No restored copy exists.** There is no test database (`MONGODB_URI_TEST` is unset), no local `mongod` (the MongoDB 8.2 install has no server binary) and no Docker. I did not create one.

Owner action: restore a recent backup of `Forex_elearning` into an isolated database whose name ends in `_test` (or into a local MongoDB), then run:

```
node scripts/phase-4-course-migration.js --database <copy> --apply
```

Run it twice. Compare course counts, statuses, `isFreePreview`, `completedAt` and certificate counts before and after.

## 3. Browser verification

**What ran.** Real Microsoft Edge 156 (headless), driven through the DevTools protocol on local files. There was no application server and no database. The combined-branch sanitizer and `SafeExternalLink` component ran exactly as the lesson page uses them (`innerHTML`, React 18 render). One sample image loaded from Cloudinary's public demo account.

12/12 checks passed, three times in a row:

| Check | Result |
|---|---|
| Lesson formatting renders as formatting (headings, bold/italic, lists, table, image, alignment class); no escaped markup | pass |
| Safe links kept; new-tab links get `noopener noreferrer` | pass |
| Control: unsanitized `onerror` **does** run in this browser (the harness detects execution) | pass |
| 12 malicious payloads (`onerror`/`onload`/`ontoggle`, `<script>`, iframe `srcdoc`, SVG, mXSS, `noscript` breakout, `javascript:` links including obfuscated, `data:` SVG, form action), with every link and button clicked: **0 executions** | pass |
| Control: a raw React `<a href="javascript:…">` **does** run when clicked (React 18 does not block it, which confirms H3 was real) | pass |
| `SafeExternalLink`: unsafe links render with no `href` and nothing runs when clicked; safe links are real new-tab links | pass |

A screenshot of the run is saved in the session scratchpad. One early run reported a syntax error caused by the harness's inline scripts; after moving to external scripts it did not recur.

**What could not run.** These need the application running against a database: admin publish, archive and restore; deletion restrictions; instructor submit and withdraw; reorder arrows; the free-preview checkbox; the admin instructor picker; a student's view of an archived course; an enrolled student's access. There is no local MongoDB, and running against production is not allowed. The server rules behind them are covered by tests (39 Phase 4 tests, using an in-memory database stand-in), but the screens are **not** browser-verified.

Owner action: provide a local or test MongoDB, for example MongoDB Community Server, `mongodb-memory-server` as a dev dependency, or a non-production Atlas database ending in `_test`. Then run the app with test-only settings (no Paystack, Resend or Cloudinary keys) and follow the checklist in §8.

## 4. Protected media delivery: design (not implemented)

### What production actually uses (read-only inventory)

- All 34 lesson videos are **YouTube** links.
- No lesson has a PDF.
- All 55 resource links point to **outside sites**.
- **32 images in 14 lessons** are Cloudinary uploads (`forexorbit/instructors`, public delivery). 14 lessons also embed images from other hosts.
- No course has a thumbnail.

So the only private media this app stores is those 32 lesson images. The YouTube videos and outside resources cannot be protected by this app whichever option is chosen.

### Options compared

| | A. Cloudinary authenticated + signed URLs | B. Backend proxy with short-lived tokens | C. Move to cookie sessions |
|---|---|---|---|
| How it works | Upload as `type: authenticated`. The lesson read rewrites image URLs to signed URLs after the access check. | Upload as `authenticated`. The lesson read rewrites images to `/api/media/<id>?t=<token>`. The token is an HMAC of user, lesson, asset and a 10-minute expiry. The route checks the token and the current entitlement, then fetches from Cloudinary with server credentials and streams the image (`Cache-Control: private`). | Replace the stored login token with an HttpOnly cookie, so the browser sends credentials with `<img>` and `<video>` requests and the route checks them directly. |
| Security | Signed URLs for authenticated assets **do not expire** unless the paid token-authentication add-on is enabled; a leaked URL works for ever. Expiring URLs are possible through the API `private_download_url`, but that serves downloads, not inline images. | Short expiry, and access is checked again on every request, so revoking a refund, withdrawal or archive takes effect at once. Cloudinary credentials never reach the browser. | Strongest per-request check. Also removes the stored token that XSS can steal, a real bonus. |
| Fit with this app | Small change in the lesson read. | Adds one route and the URL rewrite in the lesson read; the frontend is unchanged. | Large: login, logout, socket handshake, the API client and every route change; CSRF protection is needed; touches Phase 1–3 auth code. |
| Performance and bandwidth | Served by the CDN directly. | Images pass through the app server on Render. For 32 small images this is negligible; add an in-memory LRU and HTTP `ETag`. | CDN cannot cache per-user; same proxy cost as B. |
| Video and range requests | Works with the CDN. | Needs the `Range` header passed through. Not needed today: all videos are on YouTube. | Same as B. |
| PDFs and documents | Works. | Works (stream with `Content-Disposition: inline`). | Works. |
| Expiry and revocation | Weak (see above) or paid add-on. | Strong. | Strong. |
| Moving existing media | Re-upload 32 images as authenticated and rewrite 14 lessons: a production storage operation. | Same. | Same, plus the auth migration. |
| Cost and operations | Plan-dependent. | No plan change; a little server bandwidth. | High engineering and testing cost. |

### Recommendation: B, backend proxy with short-lived tokens, for stored lesson images only

1. Keep thumbnails public, as approved.
2. New lesson-image uploads use `type: authenticated`. Lesson HTML stores a stable reference (`cld:<publicId>`), never a signed URL.
3. `readLessonDetail` and the lesson lists rewrite references into token URLs, only after the existing read and paywall checks pass. The catalogue and outline never contain them, as today.
4. `GET /api/media/lesson/:assetId` checks the token, then rechecks enrolment, entitlement and course status. It streams the image or returns 403/404. No Cloudinary URL is ever sent to the browser.
5. Owner-run migration (dry-run, then apply): copy the 32 images to authenticated delivery, rewrite the 14 lessons, then delete the public originals after a reference check.
6. Separately, a product decision on YouTube: paid lesson videos on public or unlisted YouTube can be watched by anyone with the link. Protecting them means moving them to a host the app controls (for example Cloudinary video through the same proxy, with `Range` support), which brings bandwidth costs.

Option C is not justified for media alone. Consider it later as an XSS hardening project for the stored login token.

## 5. Published-course revision workflow: design (not implemented)

### Current schema facts

- Lessons are found by `courseId` (string) in more than 20 places.
- Quizzes are keyed by `lessonId`.
- Progress stores lesson ids in `completedLessons`.
- Purchases and certificates are keyed by course id.
- So **live lesson ids must never change**, and draft lessons must never carry a live `courseId`, or students would see them.

### Proposed design (smallest safe)

- **Store:** a new collection `courseRevisions` with one header document per revision:
  - `courseId`, `baseContentVersion`, `state` (`draft` | `in_review` | `rejected` | `published` | `withdrawn`), `createdBy`, `course` (proposed title, description, category, difficulty, thumbnail), `lessonOrder` (ids), timestamps, review notes.
  - Plus one entry per changed lesson, with `kind: 'lesson'` and `revisionId`, holding `liveLessonId` (null for a new lesson), `action` (`edit` | `add` | `delete`), the proposed fields, `isFreePreview` and a draft quiz.
  - **Owner action:** add `courseRevisions` to the app's Atlas custom role (`lib/app-database-role.js`, then regenerate the role JSON).
  - The alternative of putting draft lessons in `lessons` without a `courseId` avoids the role change but is riskier: any future query that forgets the filter would expose drafts.
- **One open revision per course:** `courses.activeRevisionId` is set with a conditional update, so a second revision can't start.
- **Instructor edits** go to the revision only. Live course content can't change, which already holds: Phase 4 locks published courses for instructors.
- **Review:** the instructor submits (`in_review`). An admin approves, which publishes, or rejects with a note (`rejected`, live content untouched). The same role rules as the course lifecycle apply.
- **Publish** happens in one MongoDB transaction (Atlas is a replica set), guarded by `courses.contentVersion === baseContentVersion`. If an admin edited the live course meanwhile, publishing returns 409 and the revision must be rebased. Inside the transaction:
  1. Apply course field changes.
  2. Edits: `$set` onto the **same** live lesson ids, so progress, quiz scores and certificates stay attached.
  3. Additions: insert new lessons with server-assigned positions.
  4. Deletions: delete the lesson and its quiz. Students' history keeps the id, and the progress rule ignores lessons that no longer exist.
  5. Apply the order with the existing reorder logic.
  6. Increment `contentVersion`, clear `activeRevisionId`, write an audit entry.

  After commit: `recomputeCourseProgress` and media cleanup for images that were removed.
- **Effect on students:** completion stays recorded (`completedAt`). New lessons lower coverage without revoking completion, as in Decision 4, and free previews follow their explicit flags.
- **Tests to add with it:** live content unchanged while a revision is open; rejection changes nothing; publish keeps lesson ids; deleting a completed lesson does not inflate progress; concurrent publish and admin edit conflicts (409); a student never sees revision lessons.

## 6. Certificate issuance review

| Item | Admin route `POST /api/admin/send-certificate` | Student route `POST /api/certificates` |
|---|---|---|
| Authorization | Admin or Super Admin (`decideStaffCertificate`) | Any signed-in account, for itself |
| Completion check | **None.** Staff can issue a certificate to any student for any course, without enrolment or completion and in any course state. | Phase 4: `courseCompletion` (recorded, current or historical); active enrolment required |
| Uses `completedAt` | Only records counts | Yes; sets it on issue if missing |
| Duplicates | `findOne` then `insertOne`: **race window**, and there is **no unique index** on `{ userId, courseId }`. Production currently has 0 duplicates. | Same |
| Audit log | **None** (only `issuedBy` email inside the certificate) | None |
| Other | `studentIdentifier` is used directly in `users.findOne({ email: studentIdentifier })`. A JSON object such as `{"$gt": ""}` would match an arbitrary student (operator injection, staff-only). With `sendEmail`, the student's email is written to the server log. | |

**Recommended smallest correction (needs your approval; the policy is unchanged):**

1. Require `studentIdentifier` and `courseId` to be strings.
2. Remove the email from the log.
3. Write an `adminAuditLog` entry for every staff issue.
4. Store `completionBasis` from `courseCompletion` on staff-issued certificates. If the student has not completed, require a short `reason`. This keeps manual issuance possible but makes it explicit and audited.
5. Owner action: build a unique index on `certificates { userId: 1, courseId: 1 }` (0 duplicates today), using the existing index-script pattern.

## 7. Blockers before production

1. Merge the two branches (`package.json` and `package-lock.json`), then rerun the full checks. The combined result was already verified in a scratch copy.
2. A local or test database for the browser checklist in §8. **Not done.**
3. Migration rehearsal on a restored copy. **Not done**; the simulation above is not a substitute.
4. Decide on the 23 unverified completions (§2).
5. Approve the deviation that published courses are edited only by admins until the revision workflow (§5) exists.
6. Protected media: approve option B and the move of the 32 images, or accept public lesson images for now. Separately decide on YouTube.
7. Certificate route corrections and unique index (§6).
8. Decide what to do with the 3 orphaned lessons and 159 certificates for deleted courses (kept; nothing changes them).

## 8. Owner actions, in order

1. Approve committing both branches as they are. On commit, `core.autocrlf` normalises line endings.
2. Provide a test MongoDB and run the browser checklist:
   - Admin: publish, archive, restore; the delete button visible only to the Super Admin and refused for a course with enrolments.
   - Instructor: submit and withdraw; editing blocked outside draft.
   - Reorder arrows.
   - Free-preview checkbox and a student opening that lesson.
   - Admin instructor picker lists only active instructors.
   - Student: an archived course still open; a new student cannot enrol; checkout refused.
   - Lesson formatting renders, and an unsafe resource shows as plain text.
3. Restore a backup to a `_test` database; run the migration with `--apply` twice and compare.
4. Decide the open items in §7 (3–8).
5. Deploy to staging and run the migration read-only, then with `--apply` at deploy time, before the new free-preview rule matters.
6. Set `MEDIA_CLEANUP=delete` only after confirming cleanup reports in the logs.

## 9. Confirmation

- Production was only read, with counts and aggregates. Every collection handle in the review script was wrapped to refuse writes. No URI, credential, name, email or id was printed or stored in these reports.
- No `--apply` was run against any real database.
- No storage, settings, environment variables, emails, payments or certificates were touched.
- No commit, stage, push, merge or deploy. The audit report, the original folder and the unrelated worktrees are unchanged.
