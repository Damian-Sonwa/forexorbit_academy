# Operational scripts

None of these scripts run from `npm test`, `npm run build`, or `npm install`.

`npm run seed` runs `seed/seed.js` only when someone invokes it. It requires `DEMO_SEED_PASSWORD` and does not print that value. `seed/seed.ts` is not an npm script. It requires the same password and deletes collections only when `DEMO_SEED_ALLOW_WIPE=yes`.

`server.js` calls `scripts/seed-rooms.js` during `npm run dev` and `npm start`. That call inserts the Beginner, Intermediate, and Advanced community rooms when they are missing. It does not delete rooms or other collections.

Run the other scripts only with an explicit operator command and a database you intend to change:

| Script | Effect |
| --- | --- |
| `backup-data.js` | Reads every collection and writes JSON under `backups/`. |
| `restore-data.js` | Deletes every document in each restored collection, then inserts the backup. |
| `purge-visual-aids-from-db.js` | Updates stored lesson HTML. |
| `migrate-lesson-summaries.js`, `add-lesson-summaries.js`, `update-lesson-summaries-detailed.js` | Update lesson documents. |
| `add-missing-quizzes.js`, `add-visual-aids-to-lessons.js` | Insert or update lesson content. |
| `init-consultation-system.js` | Initializes consultation data. |
| `learning-indexes.js` | Reports the learning indexes L1-L9; builds them only with `--apply` (refusing, building nothing, on any conflict). Existing equivalent indexes count under their own names (L2, L3), and L1 is covered by the unique `progress_user_course` prefix. `--rollback` drops only indexes under this script's own names and exact definitions. |
| `assessment-indexes.js` | Reports the Phase 9 indexes A1-A6 and their duplicate checks; builds them only with `--apply`, and refuses (building nothing) while any conflicts or a unique index would meet duplicates. An existing index with the same key and options counts under any name (lib/index-plan.js). |
| `quiz-lesson-unique.js` | A4 owner operation: converts the existing `quizzes_lesson` index to unique in place, one step per run (`--prepare`, `--convert`, `--abort`); read-only by default. Needs `collMod` on `quizzes`; never drops the index or touches a document. Runbook: `docs/audits/phase-10-index-rollout-runbook.md`. |
| `quiz-attempt-reconcile.js` | Reports interrupted quiz attempts, overdue attempts and pending assignment awards; finishes them only with `--apply`. Run by hand; nothing schedules it. |
| `trading-indexes.js` | Reports the Phase 10 indexes T1-T18 and their duplicate checks; builds them only with `--apply`, and refuses (building nothing) while any conflicts or a unique index (T6, T8, T11) would meet duplicates. Reports the collections `--apply` would create. |
| `trading-reconcile.js` | Compares every practice account with its ledger and reports differences, which it never repairs. With `--apply` it also finishes interrupted work. Reads every record, 200 at a time; a record that fails is reported and the run carries on. |
| `market-init.js` | Creates and activates the simulated market; writes only with `--apply`. Never prints the seed. A rerun never replaces the market: it reports its health, and with `--apply` finishes an interrupted catch-up (never lifting SUSPENDED or ERROR). |
| `trading-retention.js` | Reports expired and inactive practice-trading records; purges expired anonymous records only with `--apply`, under an operator account. |
| `market-data-import.js` | Checks an approved market-data manifest and quote file; writes them, inactive, only with `--apply`. |
| `atlas-role.js` | Prints, writes (`--write`) or checks (`--check`) the `forexorbitAppRole` JSON in `docs/audits/atlas/`, generated from `lib/app-database-role.js`. Never connects. |
| `check-backup.js` | Reads a backup. |
| `set-superadmin.js`, `reset-superadmin-password.js` | Disabled. They exit before connecting. |
| `generate-jwt-secret.js`, `generate-password-hash.js` | Local helpers. They do not select an account. |
| `guard-commit-paths.js` | Commit check. It does not connect to a database. |

Do not point these scripts at production.
