# Certificate unique index: runbook and production record

Index: `certificates { userId: 1, courseId: 1 }`, `unique: true`, name `uniq_certificate_user_course`. It is not sparse and not partial.

`scripts/certificate-indexes.js` only creates this index. It never drops or changes another one.

## Production record: 31 October 2026 — **created and verified**

The record below contains counts, timestamps and names only, never a connection string or credential.

**Connection.** The application's existing `MONGO_URI` (owner-approved reuse; no new credential, file or `.env` variant was created) was passed in memory to the script's child process as `CERTIFICATE_INDEX_MONGO_URI`.

- Host: the Atlas cluster.
- Server-side identity: `forexorbit_app`.
- Roles: `forexorbitAppRole@admin` and `forexorbitLearningIndexRole@admin`. The owner added the second role for this operation.

**Read-only check before applying (07:58 UTC):**

- Target `Forex_elearning.certificates` exists (33 collections in the database).
- `listIndexes` permitted; only `_id_` was present.
- certificates 192.
- duplicate `(userId, courseId)` pairs 0.
- missing or null ids 0.
- ids not stored as text 0.
- Certificate content identical to the 31 October pre-migration export.
- Script verdict: `missing`, safe to build.

**Apply:** 07:59:15–07:59:18 UTC. Script output: `index uniq_certificate_user_course: present`.

**Verification after applying (07:59:34 UTC):**

- The script's read-only check reports `present`.
- The `certificates` indexes are exactly `_id_` (unchanged) and `uniq_certificate_user_course`: key `{ userId: 1, courseId: 1 }`, unique true, not sparse, not partial.
- certificates 192 → 192.
- The SHA-256 of all certificate documents is unchanged and still equal to the 31 October export.
- The database's collection list is unchanged (33).
- No other production write was made.

**Recovery.** The verified local export `C:\Users\Juliet\Downloads\forexorbit_backups\Forex_elearning_phase4_premigration_2026-10-31T00-34-01Z\` holds all 192 certificates. It is a local export, not an Atlas snapshot, and restoring it onto a real server has not been tested.

Building an index never modifies documents. To undo, an account with index privileges can run `dropIndex('uniq_certificate_user_course')` on `Forex_elearning.certificates`.

## Earlier state (06:28 UTC, read-only, app role only)

Counts were the same. The index state was **unknown**, because `forexorbitAppRole` could neither list nor create indexes.

## Running it again (no secret is typed into chat or committed)

The read-only check (`--apply` omitted) prints counts and the index state, never the connection string.

**Option A: a connection file kept outside any Git repository.** It contains only `CERTIFICATE_INDEX_MONGO_URI=...`.

```
node scripts/certificate-indexes.js --database Forex_elearning --connection-file <path outside the repository> [--apply]
```

**Option B: the shell environment.** Set `CERTIFICATE_INDEX_MONGO_URI` (or `MONGO_URI`) in the environment of the process that runs the command. Do not type the value into a logged terminal.

Safety rules:

- The option is `--connection-file`, not `--env-file`: Node 22 claims `--env-file` itself and would load the file into the whole process environment.
- With `--connection-file`, nothing else is read: no `.env`, `.env.local` or `MONGO_URI` fallback.
- `Forex_elearning` is only reached on the Atlas cluster (`*.mongodb.net`). A connection-file run only targets `Forex_elearning`. Local servers are only for databases ending in `_acceptance` or `_test`.
- The run stops if `Forex_elearning.certificates` does not exist.
- `--apply` is refused when the index state is unknown or conflicting (including a sparse or partial look-alike), or when the data has duplicates, missing ids or non-text ids.
