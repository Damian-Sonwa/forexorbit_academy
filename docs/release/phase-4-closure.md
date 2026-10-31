# Phase 4 closure: course catalogue and management

**Status: CLOSED. Implementation accepted, committed locally; not yet released.**

| Item | Value |
|---|---|
| Worktree | `C:\Users\Juliet\Downloads\forexorbit_academy-phase-4-integration` |
| Branch | `integration/phase-4-validation` (local only, no upstream) |
| Commit | `f3e728a`, parent `c2e9715` (unchanged since acceptance) |
| Lineage | `origin/master` (`d7e0d1d`, the last released code) is an ancestor, so a release can fast-forward |

## Scope delivered

- Course lifecycle: draft → in review → published → archived.
- Instructor ownership; Admin and Super Admin powers.
- Protected lesson access and explicit free previews.
- Progress preserved across lesson changes.
- Protected deletion (Super Admin, with dependency checks).
- Sanitized lesson HTML and refusal of unsafe links.
- Certificate safeguards.
- The acceptance harness.
- Pre-existing defects fixed:
  - `POST /api/progress` returned 500, and levels never advanced;
  - room seeding used the connection string's default database.

## Validation at closure (31 October 2026)

- 708/708 tests, tsc 0 errors, ESLint 0 errors, build passes.
- Acceptance 72/72 against the real application on a local MongoDB.
- A live learning-level check of 18/18 on a disposable database.

## Production state (verified 31 October 2026)

- **Migration:** course status and preview flags were applied to `Forex_elearning` at 00:37 UTC. Record: `docs/audits/phase-4-production-migration-2026-10-31.md`.
- **Certificate index:** `uniq_certificate_user_course` `{ userId: 1, courseId: 1 }` was built at 07:59 UTC. It is unique, not sparse, not partial.
  - Certificates: 192 before and after, contents unchanged.
  - Record: `docs/audits/phase-4-certificate-index-runbook.md`.
  - **Do not recreate or change it.**
- **Not released:** production still runs the pre-Phase 4 code. The Phase 4 code reaches production with the combined release (`production-deployment-runbook.md`).

## Follow-up (separate commit)

- **Learning progression:** only published courses count toward a level.
  - Branch `fix/learning-level-published-courses`, commit `d14a756`, parent `f3e728a`.
  - 716/716 tests, 8 new, 5 of which fail on the old query; acceptance 72/72.
- **Combined with Phase 4.5:** checked in a throwaway tree — 754/754 tests, tsc, build, acceptance 77/77.
- **Deliberately unchanged:** `scripts/seed-rooms.js` falls back to `Forex_elearning` when `MONGODB_DB_NAME` is unset. That is the application's own rule, so it keeps working.
