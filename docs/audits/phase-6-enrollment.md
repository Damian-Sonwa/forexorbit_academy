# Phase 6: enrollment and course access

Branch `feat/phase-6-enrollment`, from `feat/phase-5-payments` at `62661cd` (the Phase 5 release candidate). It is not committed, pushed or deployed. No Paystack call was made: Paystack is a stub in every Phase 6 test, and the end-to-end server ran without a Paystack key.

## 1. How it worked before (audit)

**Records:**

- `progress` holds one enrollment row per student and course (`active`, `withdrawnAt`, `completedLessons`, `progress`, `completedAt`). Rows are never deleted; withdrawal sets `active: false`.
- `userCourseAccess` holds one entitlement row per student and course (unique index I4). It is entitled when `paid: true` or `entitlementType` is `complimentary` / `manual_grant`. A refund with access removal sets `paid: false`, `entitlementType: 'refunded'`.
- There is no free-course concept: every course is ₦10,000. Free-preview lessons (course configuration, Phase 4) and demo lessons are open to enrolled students; everything else needs the course entitlement. There is no access expiry: purchases are permanent unless refunded with access removal.

**Who could do what:**

- Every API route uses `withAuth` (Phase 4.5 server sessions, HttpOnly cookie, CSRF header, exact Origin). Account status is re-read on every request, so suspended and deactivated accounts are refused everywhere.
- The lesson read, the lesson list and the quiz routes enforced both enrollment and the paywall.
- Enrollment was free for published courses only. Archived courses took no new or returning students.

## 2. Defects found

| # | Finding | Effect |
|---|---|---|
| D1 | `POST /api/progress` checked enrollment but not the paywall. | An enrolled student who never paid could mark paid lessons complete, reach 100%, get a recorded completion and the learning-level upgrade that follows. |
| D2 | `POST /api/certificates` checked completion only. | With D1, or with a completion recorded before a refund removed access, a certificate could be issued for a course the student does not own. (The certificates feature is switched off by its flag, so this was latent.) |
| D3 | Assignments (list, read, submit) checked enrollment but not the paywall. | Instructions of assignments attached to paid lessons, and course-level assignments, were readable and submittable without paying. |
| D4 | Lesson chat (HTTP and Socket.IO) checked enrollment but not the paywall. | Discussions of paid lessons were readable and writable without paying. |
| D5 | No unique index on `progress` `{ userId, courseId }`. The enroll route checks, then inserts. | Concurrent enroll requests could create duplicate enrollment rows. The route already mapped duplicate-key errors to "Already enrolled", but no index existed to raise one. |
| D6 | A verified payment did not create an enrollment. Lesson routes need both. | A student who paid without enrolling (or after withdrawing) saw "Not authorized" until they enrolled. If the course was later archived, enrollment was refused and they were locked out of a course they paid for. |
| D7 | `GET /api/certificates/:id` checked ownership for students only. | Any instructor could read any certificate by id, including the student's name and email. An invalid id answered 500. |
| D8 | Course list and course page swallowed enrollment errors (console only); buttons could be clicked repeatedly. | No feedback on refusals (archived course, already enrolled); duplicate requests. |
| D9 | No way for an administrator to see a student's enrollments and entitlements together, or to grant or revoke complimentary access except by editing the database. | Grants were untraceable. |

## 3. What was implemented

### 3.1 One server-side access rule (`lib/course-lesson-list.js` `courseContentAccess`)

- It uses the same rule as the lesson read and lesson list (`priceCourseLessons`):
  - free previews (course configuration) and demo lessons are open;
  - other lessons need the full-course entitlement, or a legacy purchase of that lesson;
  - staff are decided by the existing read rules.
- `isOpen(lessonId)` answers for one lesson. `isOpen(null)` (course-level material) needs every lesson open.
- It is used by:
  - `POST /api/progress` (D1): 403 `lesson_locked`; nothing is recorded;
  - `POST /api/certificates` (D2): 403 `course_access_required` unless the course is open in full. It also finds enrollments stored with an ObjectId course id;
  - assignments (D3): locked ones are left out of the list; read and submit answer 403 `assignment_locked`;
  - lesson chat (D4): `GET`/`POST /api/messages` answer 403 `lesson_locked`. In `server.js`, `joinLesson`, `chatMessage` and the per-message member re-check apply the same rule.

### 3.2 Enrollment integrity

- **Unique index E1** `uniq_enrollment_user_course` `{ userId: 1, courseId: 1 }` on `progress` (`lib/enrollment-indexes.js`, `scripts/enrollment-indexes.js`) (D5).
  - The script is read-only by default. It reports duplicate groups (exact, and rows whose course id is stored with a different type).
  - `--apply` refuses while exact duplicates exist. It never merges or deletes rows.
  - It shares the production target rules of the Phase 5 index scripts.
- **`lib/enrollment-store.js` `ensureActiveEnrollment`** creates the row if missing; a concurrent creation loses on E1 and counts as existing. It reactivates a withdrawn row only when asked.

### 3.3 Payment → enrollment (D6)

- Phase 5's `grantCourseEntitlement` (the only grant path: checkout confirmation, webhook, reconciliation) now enrolls the student.
- A **new** payment also reactivates a withdrawn enrollment.
- A replayed confirmation or webhook never re-enrolls a student who left.
- Not fatal: if the enrollment write fails, the payment and entitlement stand, and reconciliation repairs it.
- **Reconciliation R4** `entitlement_without_enrollment`: an entitled student with no enrollment row at all is enrolled (with `apply`). This covers payments made before Phase 6 and interrupted confirmations. A withdrawn row is the student's choice and is never reactivated. No Paystack call is needed.
- **Archived courses:** a student who holds the entitlement can still see an archived course they bought and enroll in it again (`canSeeCourse` `owned`, `decideEnroll` `entitled`). Nobody else can. An entitlement never opens a draft.

### 3.4 Student experience (D8)

- **Course list and course page:** they now show `owned` (full-course access) and `completed` for students.
  - Course cards show "Completed", "Full access" and "Archived" chips.
  - The Enroll and Unenroll buttons are disabled while a request runs, and they show the server's message on failure.
- **Course page:**
  - "You have full access to this course." and "Completed" notes;
  - archived courses show "This course is archived and no longer takes new students." instead of an Enroll button, unless the student owns it;
  - enrollment errors are shown;
  - leaving a course asks for confirmation and says the purchase or progress is kept.
- **Landing page catalogue:** same busy state and error message.
- `useCourses` now rethrows API errors with their response, so callers show the server's message.

### 3.5 Super Admin course access (D9)

- **New page `/admin/course-access`:** a "Course Access" link in the Super Admin menu.
- **API `GET`/`POST /api/admin/course-access`:** wrapped in `withAuth(['superadmin'])` plus `superAdminOnly`, with the ledger write rate limit.
- **Overview:** a student's enrollments and entitlements, by email or account id.
- **Grant:** complimentary access (the existing `complimentary` entitlement type), which also enrolls the student.
  - Published or archived courses only; students only.
  - Refused when already entitled.
- **Revoke:** complimentary or manual grants only (`entitlementType: 'grant_revoked'`).
  - Paid access is refused (409 `paid_access`); it ends only through a Phase 5 full refund with access removal.
  - The enrollment row is kept.
- **Every grant and revocation:**
  - needs a reason (5–500 characters);
  - is conditional on the access row not having changed since it was read;
  - keeps the previous state in `accessHistory`;
  - is written to the append-only `adminAuditLog` (`entityType: 'course_access'`), which the audit trail can now filter.
- No new role or privilege: Super Admin only. Account approval stays Super Admin only and unchanged.

### 3.6 Certificates detail (D7)

- Instructors see only certificates of their own courses.
- An invalid id answers 400.
- Admins and the Super Admin are unchanged.

## 4. Enrollment and access lifecycle (now)

**Enrollment:**

- **Free enrollment:** a student enrolls in a published course. E1 makes it one row, and concurrent requests answer "Already enrolled".
- **Before payment:** free previews and demo lessons open. Progress, quiz, assignments and chat work on those only.
- **Payment:** Phase 5 confirms with Paystack. Then the entitlement is created, the enrollment is created or reactivated, and every lesson opens.
- **Failed, pending, abandoned or unknown payments:** nothing is granted, and no enrollment is created by them.

**Refunds (Phase 5 rules, unchanged):**

- Partial refunds never change access.
- A full refund changes access only when the Super Admin chose removal, and only once Paystack reports it processed.
- After removal, paid lessons, progress on them, assignments, chat and certificates close. Free previews stay open. Payment, refund, access and enrollment rows are all kept.
- Pending, failed and uncertain refunds change nothing. Repeated events change nothing.

**Withdrawal:** keeps the row and its history. The student may return, including to an archived course they own.

**Completion:** recorded at 100% of the course's current lessons (Phase 4 rules). A certificate also needs the whole course open.

## 5. Testing (31 October 2026, executed)

| Suite | Result |
|---|---|
| `npm test` (all unit and route tests) | **811/811** (789 before + 22 in `tests/phase-6-enrollment.test.js`) |
| Phase 6 tests | 22/22, real routes with Phase 4.5 sessions and CSRF, against the in-memory database with the real unique indexes. Mutation-checked: disabling the progress gate, the certificate gate, payment enrollment, the assignment filter, the archived-owner rule, the chat gate, the certificate ownership check or the replay rule each fails tests |
| Real MongoDB (`npm run test:mongo:enrollment`, new) | **2/2**: E1 refuses over exact duplicates, reports cross-type ones, builds, is idempotent and rejects a second row; 8 concurrent enrollments and 3 concurrent payment confirmations give one row |
| Real MongoDB payments (`test:mongo:payments`) / rate limits (`test:mongo`) | 4/4 / 12/12 |
| `scripts/enrollment-indexes.js` on a local test database | read-only report; refusal while a duplicate exists (exit 1); build after review; refusal of `Forex_elearning` on a non-Atlas host |
| TypeScript | 0 errors |
| ESLint (`npm run lint`) | 0 errors; 633 warnings (624 before; the new ones are `require()` style in the new CommonJS libraries and scripts) |
| Production build | passes |
| Phase 4 acceptance | 77/77 |
| Phase 4.5 sessions end-to-end | 36/36 |
| Phase 5 payments end-to-end | 28/28 |
| **Phase 6 end-to-end** (`scripts/acceptance/enrollment-e2e.js`, new; real app, headless Edge, desktop and phone) | **42/42** |

The Phase 6 end-to-end run (42 checks) covers:

- concurrent enroll;
- archived-course rules;
- direct URLs to paid lessons;
- progress on locked lessons;
- Super Admin grant, revoke, paid-revoke refusal, audit and filter;
- course list states;
- a double-clicked card creating one enrollment;
- the course page offer after revocation;
- the course-access page on desktop and phone;
- the menu link;
- no fixture emails in the log.

**Not executed:**

- Paystack test-mode charges. Phase 6 changes only what happens after Phase 5 verification, which runs unchanged and is covered by stubs, the real-MongoDB test and the Phase 5 suites.
- Firefox, Safari and iOS.
- The socket gate is checked as a source contract and through the shared rule, not through a live socket client.

## 6. Remaining limitations

- **Production data was not inspected.** A read-only count of `progress` duplicates on `Forex_elearning` was blocked by the session's permission rules. Whether E1 can be built is unknown until `scripts/enrollment-indexes.js` is run read-only against production (section 7).
- **Certificates are switched off** by `FEATURES.CERTIFICATES = false`. The new certificate rule applies once they are enabled.
- **Lesson media** (`videoUrl`, `pdfUrl`, resources) are external links (for example Cloudinary). The API withholds them for locked lessons, but a URL already obtained is not access-controlled by the app.
- **Existing completions** recorded through D1 before this fix are kept (history is never rewritten). They no longer earn a certificate without access.
- **`recordLessonCompletion`** (Phase 4) matches string course ids only. Very old enrollments stored with an ObjectId course id cannot record new progress. Unchanged.

## 7. Deployment requirements (owner)

1. **Database index E1** (needs an account with find, listIndexes and createIndex on `progress`; not the app role):
   - read-only: `node scripts/enrollment-indexes.js --database Forex_elearning --connection-file <file outside Git>`;
   - if it reports exact duplicates, they need review before `--apply`. Cross-type groups are reported for review only;
   - then `--apply`, and read-only again: E1 `present`.

   Until E1 exists, concurrent enroll requests can still create duplicate rows (the rest of Phase 6 works).
2. **No app-role change.** `progress`, `userCourseAccess` and `adminAuditLog` are already covered. Run `node scripts/check-db-role.js --database Forex_elearning`; it should still PASS.
3. **No new environment variable.**
4. **After deploy:** one reconciliation pass (`/admin/purchases` → Run reconciliation, or the 15-minute sweep) enrolls entitled students who never had an enrollment row.
5. **Order:** Phase 5 must be released first (Phase 6 is built on it). Then E1, then Phase 6.
