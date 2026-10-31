# Database role and index requirements

Nothing in this document has been applied to production. Each step needs the owner's explicit approval at the time.

## 1. Application role: `forexorbitAppRole`

The app needs `find`, `insert`, `update`, `remove` on `Forex_elearning.sessions`, and nothing more:

- no `createIndex`, `dropIndex`, `collMod`, `dropCollection`;
- no database-wide grant.

`lib/app-database-role.js` now lists `sessions` in `READ_WRITE_COLLECTIONS`, so the generated role definition and `scripts/check-db-role.js` include it.

Privilege to add (Atlas → Database Access → Custom Roles → `forexorbitAppRole` → add an action set):

```json
{ "resource": { "db": "Forex_elearning", "collection": "sessions" }, "actions": ["find", "insert", "update", "remove"] }
```

**Notes:**

- Whether the app role could create `sessions` implicitly on its first insert depends on its other privileges and has **not** been tested against Atlas. The plan does not rely on it: building the indexes (step 2) creates the collection first.
- The app uses `find`, `insert` and `update`. `remove` is not used by the current code (revocation marks rows; the TTL index deletes them with server privileges). It is included because `READ_WRITE_COLLECTIONS` grants the four actions uniformly; the owner may grant only the first three, and the app still works.

Verification (read-only, app account): `node scripts/check-db-role.js ...` as documented in `docs/audits/production-database-runbook-indexes-and-role.md`.

## 2. Indexes (privileged account, once)

| Id | Key | Options | Purpose |
|---|---|---|---|
| S1 | `{ userId: 1 }` | name `session_user` | revoke all sessions of an account |
| S2 | `{ familyId: 1 }` | name `session_family` | revoke one sign-in and its rotations |
| S3 | `{ absoluteExpiresAt: 1 }` | name `session_ttl`, `expireAfterSeconds: 86400` | TTL clean-up one day after absolute expiry |

None is unique, so building them never rejects or changes a document. Lookups by id use `_id`.

### Script: `scripts/session-indexes.js`

```
node scripts/session-indexes.js --database Forex_elearning --connection-file <path outside any Git repository>            # read-only
node scripts/session-indexes.js --database Forex_elearning --connection-file <path outside any Git repository> --apply    # build missing ones
```

Safety rules (shared code with `scripts/certificate-indexes.js`):

- the connection file holds only `CERTIFICATE_INDEX_MONGO_URI`; with it nothing else is read (no `.env` fallback), and the file must be outside any Git working tree;
- `Forex_elearning` only on `*.mongodb.net`; local servers only for `*_acceptance` / `*_test` databases;
- in production, refuses if `Forex_elearning.users` is missing (wrong database);
- read-only unless `--apply`;
- `--apply` refuses if any index state is `unknown` (the account cannot list indexes) or `conflicting` (same name or key, different options);
- builds only `missing` indexes, never drops or changes one;
- idempotent: a second run builds nothing;
- prints counts and states only, never the connection string.

The application never builds these indexes, and the app role cannot. The privileged account is the owner's (the same approach as the certificate index, which the owner approved for 31 October by granting `forexorbitLearningIndexRole` temporarily). Whether to reuse that grant or a separate admin user is the owner's decision.

Verified locally: on the acceptance server the script reported `missing` ×3, built three, then reported `present` ×3; a second `--apply` built nothing (see `implementation-report.md`).

## 3. Order

1. Build the indexes (creates the collection).
2. Add the role privilege.
3. Deploy the code.

Deploying before step 2 makes every sign-in fail (insert refused), with 500 on login. That is why the checklist puts both steps first.
