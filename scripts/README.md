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
| `check-backup.js` | Reads a backup. |
| `set-superadmin.js`, `reset-superadmin-password.js` | Disabled. They exit before connecting. |
| `generate-jwt-secret.js`, `generate-password-hash.js` | Local helpers. They do not select an account. |
| `guard-commit-paths.js` | Commit check. It does not connect to a database. |

Do not point these scripts at production.
