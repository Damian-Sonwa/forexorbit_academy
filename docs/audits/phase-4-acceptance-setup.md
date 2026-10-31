# Phase 4 acceptance testing against the real application

Status, 31 October 2026: **72/72 checks passed** against the real application.

- **Environment:** a local MongoDB Community Server 9.0.4 service (`127.0.0.1:27017`, local only) and the database `forexorbit_phase4_acceptance`, holding synthetic fixtures only.
- **Application:** the dev server (`node server.js`), with no payment, email or storage keys.
- **Browser screens:** headless Microsoft Edge.

The first runs found real defects, now fixed with regression tests:

1. **Lesson creation.** `pages/api/lessons/index.ts` did not pass the course `status` to the lesson-create decision, so every course looked published and instructors could not add lessons to their own drafts.
2. **Assignment routes.** They dropped the course `status` in the same way, so students could read assignments of draft courses.
3. **Learning level.** The dead duplicate `lib/learning-level.js` (exporting only `canAccessRoom`) shadowed `lib/learning-level.ts`. In the running app, `updateLearningLevelIfEligible` was undefined, so every `POST /api/progress` answered 500 after recording the completion, and learning-level advancement never ran. **This predates Phase 4 and also affects the current production code.**
4. **Room seeding.** `scripts/seed-rooms.js`, which `server.js` calls at start-up, seeded community rooms into the connection string's default database instead of `MONGODB_DB_NAME`. It wrote outside the isolated database, and in production possibly outside the application's database. **This also predates Phase 4.**
5. **Certificate index script.** It reported "unknown" for a collection that does not exist yet (now "missing"). It also accepted a sparse or partial index as "present" (now "conflicting").

Behaviour confirmed and recorded as policy, not defects:

- **Checkout.** It is refused with 503 `not_configured` when no payment keys exist, so the lifecycle checkout rule is covered by unit tests only.
- **Student certificates.** The student certificate pages and `/api/certificates` are switched off by the existing feature flag (`CERTIFICATES: false`); only staff issue certificates.

Production must never be used for this.

## 1. Provide an isolated database (one of)

- **Local server (simplest):** install MongoDB Community Server and start `mongod` on `127.0.0.1:27017`, with an empty data directory just for testing.
- **Dedicated test cluster:** a separate Atlas project or cluster used only for testing, never the production cluster. Use a database user that can read and write only the acceptance database.

## 2. Configure it locally (never in Git, never pasted into chat)

Create `.env.acceptance` in the integration worktree. Git ignores it (`.env.*`).

```
ACCEPTANCE_MONGODB_URI=mongodb://127.0.0.1:27017
ACCEPTANCE_DB_NAME=forexorbit_phase4_acceptance
# only for a remote test-only cluster:
# ACCEPTANCE_ALLOW_REMOTE=dedicated-test-cluster
```

The harness refuses to run if any of these is true (`scripts/acceptance/guard.js`):

- the database name is a production name, or does not end in `_acceptance` or `_test`;
- the URI equals the application's `MONGO_URI` or `MONGODB_URI`;
- the host is not local and the opt-in above is not set;
- the database already holds data that the harness did not create.

## 3. Run

```
node scripts/acceptance/run.js            # first run on an empty database
node scripts/acceptance/run.js --reset    # later runs (clears only this harness's database)
```

It seeds synthetic accounts (`*@acceptance.invalid`, random passwords held in memory), and builds the certificate unique index **in the test database**. It then starts the real application (`node server.js`) against that database, with no Paystack, Resend or Cloudinary keys, so no provider is called.

Next it runs about 70 checks through the real HTTP routes, followed by browser checks of real screens in headless Microsoft Edge. Finally it scans the server log for fixture email addresses. Exit code 0 means every check passed; the server log path is printed at the end.

Coverage by role:

- **Instructor:**
  - draft create and edit, and ownership denial;
  - lessons, unsafe link rejection, reorder that keeps the free preview;
  - submit for review, no publishing, published-course lock;
  - assignment in a draft course.
- **Admin:**
  - publish, edit a published course, archive;
  - no permanent delete;
  - no student, suspended or pending account as instructor;
  - certificate roles unchanged.
- **Super Admin:**
  - deletion refused with dependencies; override from draft to archived; deletion of an eligible course;
  - certificate needs a reason without completion;
  - audit entry recorded;
  - concurrent issuance creates exactly one certificate.
- **Student:**
  - drafts and in-review courses not listed, enrollable or purchasable;
  - enrolment;
  - non-enrolled students cannot read content; free preview; paid lesson locked;
  - completion recorded and kept after a lesson is added;
  - progress never above 100;
  - certificate on recorded completion;
  - archived course still readable when enrolled, closed to new students;
  - draft-course assignments refused.
- **Security:**
  - unauthenticated requests refused;
  - direct API role escalation refused;
  - operator-shaped certificate input refused;
  - no fixture email in server logs.
- **UI:**
  - the catalogue page;
  - the lesson page renders sanitized formatting, with an unsafe stored link shown as text and no script run;
  - admin course status chips, with no permanent delete for Admin;
  - the instructor dashboard loads.

The harness itself has **not been executed against a server**: only its guard (4 tests) and its refusal paths were run. Expect to adjust a UI selector or two on the first real run; report any failure as found.

## 4. Manual screen checklist (after the harness passes)

Sign in as each synthetic role (accounts are recreated on each run; to sign in by hand, set a known password with your own local tooling, never in Git). Then check:

- **Super Admin:** "Delete permanently" appears only on non-published courses.
- **Instructor:** "Submit for review", "Withdraw from review" and the reorder arrows. The free-preview checkbox in the lesson form.
- **Admin:** the instructor picker lists only active instructors.
- **Student:** in an archived course, enrolled content still opens.
