# R1 — Shared rate limit: index, activation and rollback

Prepared 2026-10-30 on branch `claude/intelligent-meitner-2qikrv`. **Production shared rate limiting is not active.** This document prepares it. Every production step below is for the project owner, after separate approval.

## What R1 is

The rate limits for login, signup, password reset, payments and the Super Admin ledger count in two places:
- **Each server process's memory:** always.
- **The MongoDB collection `rateLimits`:** only when `SHARED_RATE_LIMIT=mongodb` is set. That is the only way every server instance shares one count.

Each counting window is one document:
- `_id` is `rule:hashedKey:windowStart`;
- `count` is raised by a single atomic `findOneAndUpdate` with `$inc` and an upsert;
- `expiresAt` is the window end.

**R1** is the TTL index that lets MongoDB delete finished windows:

| Collection | Key | Options |
|---|---|---|
| `rateLimits` (app database, `MONGODB_DB_NAME`, default `Forex_elearning`) | `{ expiresAt: 1 }` | `name: 'ttl_rate_limit_window'`, `expireAfterSeconds: 0`, not unique |

TTL keeps storage bounded; it is not a security control. A finished window stops counting when the next window starts, because the new window is a different document, whether or not MongoDB has deleted the old one yet. MongoDB's TTL monitor runs about once a minute, so deletion lags expiry by up to a minute or two.

Existing documents can't block building R1: the index isn't unique.

## Tooling

`scripts/rate-limit-index.js` manages R1 and nothing else:

```text
node scripts/rate-limit-index.js --database <name>            # read-only: inspect and report
node scripts/rate-limit-index.js --database <name> --apply    # create R1 if it is missing
```

**What it does:**
- reports the database, the signed-in user, the collection, its document count and how many documents are past `expiresAt`;
- shows the exact R1 definition, the existing indexes on `rateLimits`, and the state: `missing`, `present` or `conflict`;
- with `--apply`, creates R1 only when it is `missing`, then reads the indexes back and verifies it.

**What it never does:**
- build, change or drop any other index (payment I1–I6, course, user, or other `rateLimits` indexes);
- drop or replace R1, even when it is defined differently;
- change any document.

**Production guard:** `--database Forex_elearning` is refused unless you add `--confirm-production Forex_elearning`. The connection string comes from `MONGO_URI` (or `MONGODB_URI`) and is never printed.

`scripts/course-payment-indexes.js` also lists R1, but its `--apply` builds the six payment unique indexes too, and refuses everything while any payment duplicate scan reports a group. Its `--rollback` drops all seven. **Use `scripts/rate-limit-index.js` for R1.**

**Expected output:**

| Situation | Output |
|---|---|
| Missing (inspect) | `state: missing` then `Would create on rateLimits: ttl_rate_limit_window. Run again with --apply to create it.` Exit 0 |
| Created | `created and verified rateLimits.ttl_rate_limit_window`. Exit 0 |
| Already there | `state: present` then `R1 is present with the expected definition. Nothing to do.` Exit 0 |
| Conflict | `state: conflict (an index with this name has a different definition)` or `(the same keys are already indexed as "<name>")`, then `An index conflicts with R1. Nothing was changed. …` Exit 1 |

## Where `SHARED_RATE_LIMIT` must be set

- **Read at runtime:** the variable is read from `process.env` on every request. It is not a `NEXT_PUBLIC_` variable, so it isn't built into the code. Setting it needs a **restart**, not a new build: Render restarts the service when an environment variable is saved.
- **Exact value:** only `mongodb` turns it on, ignoring case and surrounding spaces. Any other non-empty value leaves it off and logs `[rate-limit] SHARED_RATE_LIMIT is set but not to "mongodb"; counting per process only.` once.
- **Render:** runs `node scripts/start-production.js` → `server.js`, which serves every `/api` route, including all the limited ones. It needs the variable.
- **Vercel: not verified from here.** The frontend is also deployed on Vercel (`performance-audit.md`), and the browser sends API calls to Render when `NEXT_PUBLIC_API_BASE_URL` points there. But if the Vercel deployment also has the database connection variables, its own `/api/auth/*` routes are reachable directly. Serverless instances don't share memory, so per-process limits there are nearly meaningless.

  **Check in the Vercel project:** Settings → Environment Variables. If `MONGO_URI` or `MONGODB_URI` is present for Production, either add `SHARED_RATE_LIMIT=mongodb` there too and redeploy, which Vercel needs for new variables, or remove the database variables so Vercel can't serve the API.
- **Database access:** every instance that serves these routes must reach the same database (`MONGODB_DB_NAME`), so they share one `rateLimits` collection.

## A. Pre-activation checks (owner)

1. **Code:** the commit containing H1, H2 and R1 is deployed on Render, and on Vercel if it serves `/api`. The code is safe with the switch off: per-process limits apply.
2. **Database:** from a trusted machine, with the production URI typed at a hidden prompt (as in `production-database-runbook-indexes-and-role.md`):
   ```powershell
   $s = Read-Host 'Production URI' -AsSecureString
   $env:MONGO_URI = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
   node scripts/rate-limit-index.js --database Forex_elearning --confirm-production Forex_elearning
   ```
   Check the first line: `database: Forex_elearning | signed in as: <expected user> | mode: inspect`.
3. **Read the report:**
   - `documents` / `past expiresAt`: any number is fine. Documents exist only if the switch was ever on, and old ones are inert.
   - `existing indexes on rateLimits`: normally `_id_` only, or `_id_, ttl_rate_limit_window`.
   - `state`: `missing` → continue; `present` → skip step B; `conflict` → stop and see Rollback, item 4.
4. **Permission:** the user needs `createIndex` on `rateLimits`. The current app user (`readWrite`) has it. A user with the restricted `forexorbitAppRole` doesn't, so use a maintenance user.

## B. Create R1 (owner)

```powershell
node scripts/rate-limit-index.js --database Forex_elearning --confirm-production Forex_elearning --apply
```

- **Expect:** `created and verified rateLimits.ttl_rate_limit_window`, exit 0. The build is quick on an empty or small collection and changes no documents.
- **Verify:** run the inspect command again and expect `state: present`. Optionally, in Atlas → Collections → `rateLimits` → Indexes, check `ttl_rate_limit_window` on `expiresAt`, TTL 0 seconds.
- **Clean up:** `Remove-Item Env:MONGO_URI`.

## C. Turn it on (owner)

**Render:**
1. Open dashboard → your service → **Environment**.
2. Choose **Add Environment Variable**, with key `SHARED_RATE_LIMIT` and value `mongodb`.
3. Choose **Save Changes**, or **Save, rebuild and deploy**: either applies it, and a plain restart is enough.
4. Wait for the deploy to show **Live**.

**Vercel (only if it serves `/api`, see above):** Project → Settings → Environment Variables → add `SHARED_RATE_LIMIT` = `mongodb` for Production → Deployments → **Redeploy** the current production deployment.

## D. Verify after activation

1. **Healthy:** the Render logs show a clean start, with no `rate-limit` warnings and no `rate_limit_unavailable`. Run the signed-out smoke checks from the production runbook (release day, step 2).
2. **Counts are shared and stored in MongoDB:** sign in once with a wrong password using a test account you own. In Atlas → Collections → `rateLimits`, three documents should appear for login (`scope` `login-ip`, `login-email-ip`, `login-email`), each with `count`, `expiresAt` and a hashed `_id`. No raw email or address appears.
3. **The limit holds:** with that test account, from one network, submit a wrong password 11 times within 10 minutes. Attempts 1–10 get "Invalid email or password"; the 11th gets "Too many attempts…", which is HTTP 429 with `Retry-After`. Signing in from a different network still works. If Render runs more than one instance, this already proves sharing, because requests are spread across instances. The two-instance behaviour was also verified directly on a test database (see Testing).
4. **No failure testing on production.** Don't disconnect the production database to test the 503 path. That behaviour is covered by the real-MongoDB tests on an isolated server.
5. **Watch for a week:** 429 rates in the logs, `rateLimits` size (it should stay small thanks to R1), and any `rate_limit_unavailable` responses.

## E. Rollback

1. **Turn it off:**
   - Render → Environment → delete `SHARED_RATE_LIMIT`, or set it to an empty value → **Save Changes**, and the service restarts.
   - Vercel, if used: remove it and **Redeploy**.
2. **What changes:** each instance goes back to counting in its own memory. Login, signup, reset and payments keep working with the same limits per instance, so with N instances a client can get up to N times the limit. There's no outage and no 503 from the limiter.
3. **Check:** sign in successfully once, and run the smoke checks again.
4. **Index:** leave R1 in place. It is harmless with the switch off and only deletes expired windows. If R1 was reported as a `conflict`, nothing was changed by the tool. Inspect the conflicting index in Atlas and decide by hand. Drop it in the Atlas UI or `mongosh` only if you're sure nothing else uses it, then rerun the inspect command. The tool never drops indexes.

## Testing done for R1 (isolated, no production)

**Environment:**
- **Server:** a local MongoDB **7.0.45** in Docker (`mongo:7.0`), started inside the build sandbox, bound to `127.0.0.1:27027` only, with `--setParameter ttlMonitorSleepSecs=1` so TTL deletion could be observed quickly.
- **Database:** `Forex_elearning_r1_test`, with synthetic data only.
- **Teardown:** the container was removed afterwards.

**Test helper (`tests/helpers/mongo-test-db.js`):**
- uses only `MONGODB_URI_TEST`, and never reads `MONGO_URI` or `MONGODB_URI`;
- refuses a test URI equal to either of those;
- refuses any database not named `*_test`, and the production name;
- drops only its own test database.

| Suite | Kind | Result |
|---|---|---|
| `tests/rate-limit-index.test.js` (in `npm test`) | Unit and CLI, no database: test-database guard, argument and production guard, CLI refusal before connecting, R1 definition, switch parsing | 6/6 |
| `tests/shared-rate-limit.test.js`, `tests/auth-rate-limit.test.js`, `tests/password-reset.test.js` | Mocked MongoDB (in-memory stand-in) | unchanged, passing |
| `tests/integration/rate-limit-mongo.test.js` (`npm run test:mongo`) | **Real MongoDB** | 12/12 |
| Two real `server.js` processes (one-off check, not in the repo) | **Real multi-instance HTTP** | passed |

The real-MongoDB suite covers:
- **Index tool:** inspection creates nothing; `--apply` creates exactly R1; repeating does nothing; same-name and same-key conflicts are reported and left untouched; synthetic `paystackPayments`, `courses`, `users` and other `rateLimits` indexes are unchanged, and no payment collection is created; the CLI inspects and applies on the test database without printing the URI.
- **Limiter:** 50 simultaneous updates on one window allow exactly 10, with `count` 50 in one document; keys, scopes and windows are separate; an expired window still stored on disk no longer counts.
- **TTL:** MongoDB's TTL monitor deleted a finished window and kept the current one.
- **Failure:** an unreachable server makes the limiter return 503, never a memory fallback.
- **Switch:** on writes all three login rules to MongoDB; off writes nothing.
- **Login route:** the real login route, as two module instances on one database, gives 401 ×10 then 429, with no raw email stored.
- **Separate processes:** 4 separate Node processes (32 attempts) allow exactly 10 in total, all counted in one document. A process that exits and a new one that starts continue the count: 6 allowed, then 4 more.

**Two real servers:** both ran the production build of `server.js` on ports 3101 and 3102, with `SHARED_RATE_LIMIT=mongodb` and the test database.
- 12 wrong-password logins alternating between them gave 401 ×10, then 429 ×2.
- Server 3101 was stopped and restarted after the sixth attempt; the count continued.
- A different address still got 401 (not throttled).

**Not tested:** Atlas itself, and production. MongoDB 8 on Atlas uses the same single-document atomic update and TTL monitor.
