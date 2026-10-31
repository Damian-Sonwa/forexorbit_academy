# Phase 4 production migration: 31 October 2026

The owner authorised running `scripts/phase-4-course-migration.js` (steps `status` and `preview`) against production before the Phase 4 branches were committed. This report contains counts only: no connection string, credentials, names, emails or ids.

## Target

- **Database:** `Forex_elearning` on the production Atlas cluster.
- **Connection:** the app's own restricted role, from `MONGO_URI` in the original project folder's `.env`. That file's `MONGODB_DB_NAME` (`Forex_elearning_dev`) does not exist on the cluster, so the database was always named explicitly. The script refuses a name that does not exist (checked: `Forex_elearning_dev` was refused).
- **Applied:** 2026-10-31, 00:37:51–00:37:59 UTC.

## Code corrections made before the run

1. **Completion step opt-in.** The completion step now runs only when asked for (`--steps ...,completion`).
2. **No invented dates.** It never falls back to "now" as a completion date, and it records `completionEvidence`.
3. **`--apply` safeguards.** `--apply` requires the dry-run counts (`--expect`) and stops before any write if they differ (concurrent changes). It also requires `--rollback-file`, which is written before any write; `--rollback` undoes only values the migration wrote.
4. **Read-only enforcement.** A read-only run cannot write: every collection handle is wrapped and refuses any method other than `find`/`countDocuments`.
5. **Database check.** The database must already exist.

Tests: `tests/phase-4-course-management.test.js`, migration section (5 tests).

## Section 4: the 23 ambiguous enrolments (evidence)

All 48 enrolments stored at 100% without `completedAt` (the 25 "complete" and the 23 "ambiguous") were checked read-only:

- Every one was created and last updated within the same millisecond on 2025-12-08 (10:43:55.5 UTC). That is the same moment the courses, all their lessons and the related quiz scores were written: one seed batch.
- Every one belongs to an account on the seed script's `@demo.com` domain.
- All 192 certificates are dated on or before that seed batch. The 8 certificates of the "ambiguous" group are dated 1–7 December 2025, **before** their enrolments existed. No certificate was issued by staff.
- The brief's explanation ("a lesson was deleted and another added") does not match the data. In each of the 4 courses, all six lessons were created at the same instant. The sixth was later deleted (its quiz is still stored); no lesson was added. The stored 100% counts the deleted lesson.
- No audit log entries exist (`adminAuditLog` is empty), and there are no lesson messages.
- Only 19 of 110 enrolments show any activity after the seed batch, and none of those is at 100%.

**Disposition:**

| Group | Count | Result |
|---|---|---|
| Ambiguous, with certificate | 8 | **not verified**; certificate kept unchanged |
| Ambiguous, no certificate | 15 | **not verified**; no certificate created |
| "Complete by current lessons" (seed rows) | 25 | not stamped; their completion is seed data, not earned activity |

For all 48, stored `progress` (100) and `completedLessons` are unchanged. No `completedAt` was written, so nothing was fabricated. At runtime, Phase 4 still treats the 25 as complete because all current lessons are completed, and treats the 23 as not verified. If a lesson is later added to or removed from those courses, their stored progress is recalculated and the old value is kept in `legacyProgress`.

## Preflight

| Gate | Result |
|---|---|
| Script and called functions inspected | yes (`plan`, `applyPlan`, `courseCompletion`, `sortLessonsByOrder`) |
| Write scope | only `courses.status`, `courses.freePreviewExplicit`, `lessons.isFreePreview`; additions only |
| Dry run (read-only) | `status=6, previewCourses=6, previewLessons=6`; lessons already flagged: 0 |
| Backup | taken 00:34 UTC with the app role; details below |
| Rehearsal | on an in-memory restore of the backup |
| Concurrency | newest course write 2025-12-08; newest lesson update 2026-03-22; newest progress write 2026-10-30 07:12 UTC; `--expect` guard in place |
| Deployed application | ignores the new fields, so behaviour is unchanged until Phase 4 is deployed |

### Backup

`mongodump` was refused: the app role has no `listIndexes`. So the four collections were exported with the driver as canonical Extended JSON, which preserves types, one document per line, gzipped, with a manifest of counts and SHA-256 hashes.

- **Location:** `C:\Users\Juliet\Downloads\forexorbit_backups\Forex_elearning_phase4_premigration_2026-10-31T00-34-01Z\`
- **Contents:** courses 6, lessons 34, progress 110, certificates 192. These collections contain pseudonymous ids, no names or emails.
- **Verified:** file hashes match the manifest; every document round-trips to identical content with types preserved; the content equalled live data when verified.
- **Recovery path proven:** an in-memory restore from the files reproduced production exactly. A migration plus rollback on that restore returned a state byte-identical to the backup.
- **Precise undo:** `phase4-migration-rollback.json` in the same folder (6 course ids, 6 lesson ids, 0 progress ids). Run `--rollback <file>` read-only first, then add `--apply`.
- **Not verified:** the Atlas cluster snapshot schedule (needs the Atlas UI), and a restore onto a real server (no non-production server available). Full-collection restore path if ever needed: `mongoimport --mode=upsert` of the `.ejson` lines (gunzipped), canonical format.

### Rehearsal (in-memory restore of the backup)

- First apply: 6/6/6 written; changes only in the three approved fields; 0 progress and 0 certificate documents changed.
- Second apply: 0 written; no document changed.
- Rollback: state byte-identical to the backup.
- No student's free lesson changed.

## Apply

```
plan:    {"status":6,"previewCourses":6,"previewLessons":6,"previewLessonsAlreadySet":0}
written: {"status":6,"previewLessons":6,"previewCourses":6}
remaining after apply: all 0
```

## After apply

- **Read-only run:** all 0 remaining.
- **Second apply** (`--expect` all 0): written 0, remaining 0.

| Collection | Before → after |
|---|---|
| courses | 6 → 6 |
| lessons | 34 → 34 |
| progress | 110 → 110 |
| certificates | 192 → 192 |
| quizzes | 34 → 34 |
| quizScores | 76 → 76 |
| userCourseAccess | 2 → 2 |
| coursePurchases | 2 → 2 |
| paystackPayments | 2 → 2 |
| paystackPaymentIntents | 27 → 27 |
| paymentExceptions, adminAuditLog, messages, assignments, assignmentSubmissions, classes | 0 → 0 |
| users | 59 → 59 |

| Phase 4 field | Before → after |
|---|---|
| courses with `status` / `published` | 0 → 6 / 0 → 6 |
| courses with `freePreviewExplicit` | 0 → 6 |
| lessons with `isFreePreview: true` | 0 → 6 (exactly the old first-by-order lesson in 6 of 6 courses) |
| progress with `completedAt` | 0 → 0 |
| progress at 100% | 48 → 48 |

**Field-level comparison with the backup:**

- courses: 6 documents changed (`status` added 6, `freePreviewExplicit` added 6).
- lessons: 6 changed (`isFreePreview` added 6).
- progress: 0 changed. certificates: 0 changed. No document missing, no field removed or modified.

**Historical records, unchanged byte for byte:** 3 lessons of deleted courses, 159 certificates of deleted courses, 45 enrolments that reference deleted lessons.

## Not done (outside this authorisation)

> **Later update (31 October 2026, 07:59 UTC):** the owner separately authorised the certificate unique index, and it was created and verified (192 certificates unchanged). See `phase-4-certificate-index-runbook.md`.


- The unique certificate index (`scripts/certificate-indexes.js --apply`). Its data check passes (0 duplicate pairs, all string ids), but it is a production schema change.
- The completion step.
- Any cleanup of seed or orphan records.
