# Production database preparation (sessions)

Database `Forex_elearning` on the Atlas cluster.

**Status: not started.** No production index, role or data change has been made for Phase 4.5. Each step below needs the owner's approval at the time it is carried out.

**The certificate index is already complete. Do not touch it:** `uniq_certificate_user_course`, built on 31 October.

## 1. Session indexes

These definitions are taken from the code (`lib/session-indexes.js`):

| Id | Name | Key | Options |
|---|---|---|---|
| S1 | `session_user` | `{ userId: 1 }` | none |
| S2 | `session_family` | `{ familyId: 1 }` | none |
| S3 | `session_ttl` | `{ absoluteExpiresAt: 1 }` | `expireAfterSeconds: 86400`: MongoDB deletes a row one day after its 12-hour absolute expiry |

- None is unique, so building them cannot reject or change a document.
- Lookups by session id use `_id`, which always has its own index.

### Script behaviour

`scripts/session-indexes.js` (verified on a local test database on 31 October):

- **Read-only by default.**
- `--apply` builds only the `missing` indexes. It never drops or changes one.
- It is idempotent: a second run builds nothing.
- `--apply` is refused when any index state is `unknown` (the account cannot list indexes) or `conflicting` (an index with the same name or key exists with different options).
- `Forex_elearning` is reachable only on `*.mongodb.net`, and the script refuses if `Forex_elearning.users` is missing (a wrong database).
- The connection string comes only from `CERTIFICATE_INDEX_MONGO_URI` in a `--connection-file` kept **outside any Git repository**. With that file, nothing else is read. The string is never printed.

### Privileged account

Building indexes needs `listIndexes` and `createIndex` on `Forex_elearning.sessions`. The app role (`forexorbitAppRole`) has neither.

The temporary grant used for the certificate index (`forexorbitLearningIndexRole` on the app user) has **not** been checked for `sessions`. A read-only run reports `unknown` if it cannot list the indexes.

**Decision D4:** the owner's existing **Atlas administrator database user**, in a local connection file kept outside any Git repository and deleted after the run. Its connection string is never pasted into chat, Git or a logged terminal. No new credential is created.

### Steps (owner, in an approved window)

1. Confirm a current Atlas backup or snapshot.
2. Read-only run:
   ```
   node scripts/session-indexes.js --database Forex_elearning --connection-file <path outside any Git repository>
   ```
   Expected output: `Target: Forex_elearning.sessions. Mode: read-only.` and `missing` for S1, S2 and S3.
   - If the collection does not exist yet, the states are `missing`.
   - `unknown` means the account cannot list indexes. Stop and use the privileged account.
3. Apply:
   ```
   node scripts/session-indexes.js --database Forex_elearning --connection-file <path outside any Git repository> --apply
   ```
   Expected output: `Built: session_user, session_family, session_ttl`, then `present` ×3. **This also creates the `sessions` collection.**
4. Verify by repeating step 2. Expect `present` ×3, and nothing else changed.
5. Delete the local connection file if it was made only for this run.

## 2. Application role permissions

`forexorbitAppRole` needs, on `Forex_elearning.sessions`, the actions **`find`, `insert`, `update`, `remove`**. It needs no index privileges.

- The code uses `find`, `insert` and `update`. Revocation marks rows, and the TTL index deletes them.
- **Grant `remove` as well.** The role definition in `lib/app-database-role.js` grants the four actions uniformly to every app collection, and `scripts/check-db-role.js` reports `FAIL sessions lacks: remove` without it (checked 31 October).

### Atlas UI steps

1. Atlas → **Database Access** → **Custom Roles**.
2. Edit `forexorbitAppRole`.
3. **Add Action or Role** → actions **find, insert, update, remove** → Database `Forex_elearning` → Collection `sessions`.
4. **Update Custom Role.**

The equivalent JSON privilege:

```json
{ "resource": { "db": "Forex_elearning", "collection": "sessions" }, "actions": ["find", "insert", "update", "remove"] }
```

### Verification

Run read-only with the **Phase 4.5 code** checked out, connecting as the app user:

```
node scripts/check-db-role.js --database Forex_elearning
```

- It connects as the app user (from `MONGO_URI` in the shell environment) and sends only `connectionStatus`.
- Expected output: `PASS`.
- `node scripts/check-db-role.js --database Forex_elearning --print-role` prints the full intended role without connecting.

## 3. Order, and behaviour if a step is missing

The order is: **indexes (this creates the collection) → role → deploy.**

| State at deploy | Effect |
|---|---|
| Role lacks `insert` on `sessions` | Every sign-in fails with HTTP 500 after the password check. Nobody can sign in. |
| Role lacks `find` | Every authenticated request fails. |
| Collection absent but role granted | Whether `insert` can create it implicitly was **not tested** on Atlas. The plan avoids relying on it: step 1 creates the collection. |
| Indexes absent | Sign-in works. Revocation queries (`userId`, `familyId`) scan the collection, and expired rows are never deleted. Fix by running step 1 at any time. |

## 4. Rollback

The indexes and the role grant are harmless to the previous application version: the old code never touches `sessions`. Removing them is optional and needs an owner decision. **Never delete the `sessions` collection as an automatic rollback step** (`production-rollback-runbook.md`).
