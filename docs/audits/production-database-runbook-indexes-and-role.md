# Production database: unique indexes and app role (D2/D3, D9)

**Status (28 October 2026):**
- **Dev database:** done. The six unique indexes and the R1 TTL index are built. The script verified all 7 on `Forex_elearning_dev`.
- **Real-MongoDB rehearsal:** passed 5 of 5 with 8 independent processes (`scripts/payment-concurrency-rehearsal.js`; results in `release-readiness-2026-10-26.md`, the authoritative report).
- **Production:** not done. It needs the project owner, who holds the Atlas and production credentials. The agent has none and must not use them.

The application is not called production-ready until this runbook is completed and recorded in the authoritative report.

## What was done on the dev database

| Step | Result |
|---|---|
| Isolation check | Database `Forex_elearning_dev`, user `forexorbit_dev`, role `readWrite@Forex_elearning_dev` only |
| Duplicate scans S1–S6 (`scripts/course-payment-indexes.js`, dry run) | 0 groups in every scan; no rows without a reference or ids; no mixed id types |
| Build (`--apply`) | I1, I3, I6, I2, I5, I4 present and verified with `listIndexes` (keys, `unique`, partial filter) |
| Data check | Intents, payments, access and purchases still 5 each (all intents `paid`); `adminAuditLog` 0. The only new collection is the empty `paymentExceptions`, which MongoDB creates when an index is added to it. Index builds do not change documents |
| Role check (`scripts/check-db-role.js`) | **FAIL, as expected:** `readWrite` lets the app user update, remove and drop `adminAuditLog`. The dev user's role was not changed |

**One limitation on the evidence: when the indexes were created is unconfirmed.**
- The dry run reported all six indexes missing and `paymentExceptions` absent.
- A first `--apply` attempt stopped when its snapshot helper failed to load. Its temp file was left behind, which suggests the command stopped before `--apply`.
- The next run's "before" snapshot already showed 15 collections, and `--apply` found all six indexes present, so it created nothing.
- The indexes match the script's names and definitions exactly, and nothing else in the repo defines them. No other agent session or terminal ran the script. The creation itself was never seen in any captured output.

As a result, the full-content hash comparison doesn't span the build. The data evidence is the count check above, which matches the read-only baseline taken earlier the same morning.

**Rehearsal (later on 28 October).** There is still no local `mongod`. Instead, `scripts/payment-concurrency-rehearsal.js` ran on the dev server (MongoDB 8.0.34). It used throwaway `rehearsal_<run>_` collections built with the real I1–I6 and R1 definitions, and 8 independent Node processes. Five scenarios passed:
- concurrent checkouts share one pending intent;
- concurrent confirmations grant exactly once;
- a replayed webhook changes nothing;
- a stale claim is recovered once;
- the shared rate limit holds across processes.

The rehearsal collections were dropped afterwards, and existing dev data was not touched.

## Index definitions (as built)

Defined once in `lib/course-payment-indexes.js`; the script and the tests use the same list. Build order:

| # | Collection | Keys | Options |
|---|---|---|---|
| I1 | `paystackPaymentIntents` | `reference` | unique, `uniq_intent_reference` |
| I3 | `paystackPayments` | `reference` | unique, `uniq_payment_reference` |
| I6 | `paymentExceptions` | `reference, reason` | unique, `uniq_exception_reference_reason` |
| I2 | `paystackPaymentIntents` | `userId, courseId, kind` | unique, partial `{ status: 'pending', kind: 'course' }`, `uniq_pending_intent_per_course` |
| I5 | `coursePurchases` | `userId, courseId` | unique (full), `uniq_purchase_user_course` |
| I4 | `userCourseAccess` | `userId, courseId` | unique, `uniq_access_user_course` |

**Change from the plan: I2's partial filter.** It now also requires `kind: 'course'`. The plan's filter `{ status: 'pending' }` would also have covered legacy lesson checkouts, which can have several pending rows for one course and would have made the build fail.

**I5: full or partial.** I5 is full, not partial. The code keeps one purchase row per student and course and records earlier references in `previousPaymentReferences`, and scan S5 found no multi-row history.

**Code change that goes with I2.** With I2 in place, `releaseIntent` would have failed in one case. A newer checkout could become the pending one while an older one was being confirmed, and putting the older one back to `pending` would then break the unique rule. That turned an ordinary "payment not received yet" answer into an HTTP 500.

The fix: the older intent now stays `processing` with no claim time. The next confirmation claims it at once, and a payment on it is still granted exactly as before. Two tests cover this:
- `tests/course-purchase.test.js`: "a claimed checkout whose place was taken by a newer one…";
- a mutation check confirmed that this test fails without the fix.

## Production: indexes

Do these in order. Stop at any failure.

1. **Back up.** Take an Atlas snapshot, or confirm continuous backup, of the production cluster before anything else.
2. **Deploy the application code.** The live site runs older code from `master`. That code lacks the duplicate-key handling in `createCourseIntent` and `releaseIntent`, and building I2 under it would turn concurrent checkouts into errors. Merging `review/sprint-1-3-integration` into `master` deploys it through Render. The new code runs safely before the indexes exist, and its shared rate limit stays off until step 8.
3. **Run the dry run.** From a trusted machine, with the production connection string set only in that shell, never written to a file in the repo:
   ```powershell
   $s = Read-Host 'Production URI' -AsSecureString
   $env:MONGO_URI = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
   node scripts/course-payment-indexes.js --database Forex_elearning
   ```
   (Windows PowerShell 5.1 has no `-MaskInput`; `-AsSecureString` keeps the URI off the screen. The scripts load `.env` too, but never override a variable already set in the shell.)
   Check that the first line names the database and user you expect. The scans print counts and masked keys only.
4. **If any scan reports groups, stop.** Each group needs your decision under section 4 of `course-payment-index-migration-plan.md` (archive, don't delete). The backfill purchase `fo_1…gow7` must not be changed. `--apply` refuses while any group remains.
5. **Build during low traffic:**
   ```powershell
   node scripts/course-payment-indexes.js --database Forex_elearning --apply
   ```
   The user needs `createIndex` on the payment collections and on `rateLimits`. The current app user (`readWrite`) has it, so do this **before** step 3 of the role section below. Otherwise, use a separate maintenance user.

   The script also manages **R1**, a TTL index on `rateLimits.expiresAt` (`ttl_rate_limit_window`, `expireAfterSeconds: 0`), built last. It is not unique. Without it, rate-limit counters still work but expired windows are never deleted. The app role has no `createIndex` on `rateLimits`, so R1 must be built here, before the shared rate limit is switched on.
6. **Check the result.** The script verifies every index after building. Afterwards, watch the logs for `E11000` for a week.
7. **Clean up the shell:** `Remove-Item Env:MONGO_URI`.
8. **Switch on the shared rate limit.** Only after R1 is verified, and after the role section below if you apply it now, set `SHARED_RATE_LIMIT=mongodb` in the Render environment. Render restarts the service.
   - **Check:** payment init and confirm work as before, and the `rateLimits` collection receives documents.
   - **Rollback:** remove the variable. Routes return to the per-process limit.

**Rollback:** `node scripts/course-payment-indexes.js --database Forex_elearning --rollback` drops only the seven managed indexes (I1–I6 and R1) by name. It changes no documents.

## Production: app role (D9)

**Goal:** the app user can read and insert audit entries, but cannot update, delete or drop them. MongoDB privileges add up, so the built-in `readWrite` role must be removed, not just supplemented.

The privilege list is generated from `lib/app-database-role.js`. A test fails if the app starts using a collection the list doesn't cover. Print it without connecting:

```powershell
node scripts/check-db-role.js --database Forex_elearning --print-role
```

It contains:
- `find`, `insert`, `update` and `remove` on each of the 46 app collections (including `rateLimits`, the shared rate-limit counters);
- `find` and `insert` only on `adminAuditLog`;
- `createCollection` and `createIndex` on the three consultation collections (used by the admin "seed experts" route);
- `listCollections` on the database.

The checker fails on three kinds of problem:
- **missing:** an action the app needs;
- **audit violation:** any way to change or remove audit entries;
- **excessive:** any privilege the role does not grant on that exact resource. This includes database-wide grants, other databases, `admin` user or role management, cluster actions, and extra actions such as `dropCollection` on an app collection.

A user that still holds `readWrite` therefore fails twice: once for the audit log and once as excessive.

### Steps in Atlas (owner)

1. **Create the custom role.** In Atlas, go to **Database Access → Custom Roles → Add New Custom Role** and name it `forexorbitAppRole`. For each privilege in the printed list, add the action with database `Forex_elearning` and the named collection. Use the database-only resource for `listCollections`. Do not add any database-wide write action.
2. **Check the role first if you can.** Create a temporary user with only `forexorbitAppRole` and run the checker as that user. Expect `PASS`:
   ```powershell
   $s = Read-Host 'URI for the user to check' -AsSecureString
   $env:MONGO_URI = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
   node scripts/check-db-role.js --database Forex_elearning
   ```
3. **Switch the app user.** Edit the app's database user, add `forexorbitAppRole`, and remove `readWrite` (and any other write role on that database). Run the checker again with the app user's connection string and expect `PASS`.
4. **Smoke-test the live app:**
   - sign in;
   - open a course;
   - open the Super Admin ledger;
   - record an exception review on a test record, if you have one.

   Any "not authorized" error in the logs names the missing action.
5. **Keep a maintenance user** for index builds, migrations and backfills. It must not be the user the app runs as.

**Rollback:** give the app user `readWrite` again. That restores today's behavior, including the audit-log weakness.

## What remains

| Item | Owner |
|---|---|
| Deploy the app code that handles duplicate keys, then build I1–I6 and R1 on production (R1 before the shared rate limit goes live) | Owner, after release approval |
| Atlas custom role and app user switch, then the checker reports `PASS` | Owner (Atlas access) |
| Optional: apply the same role to `forexorbit_dev` for parity | Owner (Atlas access) |
| Cross-process concurrency test on real MongoDB (plan section 5) | Needs a disposable `mongod` |

## Release day: exact commands, in order

Run from this repository on a trusted machine. Production values are typed at a hidden prompt, never written to a file, and removed from the shell afterwards.

**0. Before anything (owner, dashboards only)**
- **Atlas backup:** go to **Clusters → `<production cluster>` → Backup → Snapshots**. Confirm a completed snapshot from today, or take an on-demand snapshot and wait for "Completed". Record its time in the authoritative report.
- **Render:** open the service `forex-elearning-app` (or your actual service), then **Settings → Build & Deploy**. Confirm **Branch = `master`** and Auto-Deploy on. `render.yaml` names no branch, so only the dashboard shows this.
- **Vercel:** the frontend is also deployed on Vercel (`performance-audit.md`). In the Vercel project, confirm its production branch. If it is `master`, the merge deploys it too. Any variables set on Render (for example `SHARED_RATE_LIMIT`) must then also be set there if Vercel serves `/api` routes.

**1. Merge (fast-forward only; it deploys)**
```powershell
git fetch origin
git merge-base --is-ancestor origin/master origin/review/sprint-1-3-integration; if ($LASTEXITCODE -ne 0) { 'master has moved: stop' }
git push origin origin/review/sprint-1-3-integration:refs/heads/master
```
A plain push is refused unless it is a fast-forward, so it can't overwrite `master`. The working tree and `template/` are not touched.

The PR alternative is https://github.com/Damian-Sonwa/forexorbit_academy/compare/master...review/sprint-1-3-integration, then **Create pull request → Merge**.

**2. After the deploy finishes: signed-out smoke checks (read-only)**
```powershell
$base = 'https://forexorbit-academy.onrender.com'   # use the URL Render shows for the service
function Code($m, $p) { try { (Invoke-WebRequest -Method $m -Uri "$base$p" -UseBasicParsing -TimeoutSec 30 -ContentType 'application/json' -Body $(if ($m -eq 'POST') { '{}' })).StatusCode } catch { [int]$_.Exception.Response.StatusCode } }
"home 200: "               + (Code GET  '/')
"course list 200: "        + (Code GET  '/api/courses')
"auth/me 401: "            + (Code GET  '/api/auth/me')
"admin purchases 401: "    + (Code GET  '/api/admin/purchases')
"payment exceptions 401: " + (Code GET  '/api/admin/payment-exceptions')
"init-course 401: "        + (Code POST '/api/payments/paystack/init-course')
"unsigned webhook 401: "   + (Code POST '/api/paystack/webhook')
```
None of these writes anything: the webhook route rejects an unsigned request before any database access. Then check the Render logs for a clean start and no `E11000` or `rate-limit-unavailable` lines.

**3. Index preflight (read-only), then build.** Follow steps 3–7 of "Production: indexes" above:
- `node scripts/course-payment-indexes.js --database Forex_elearning`, entering the URI at the `-AsSecureString` prompt;
- stop if any scan S1–S6 reports groups;
- otherwise run `--apply` and expect "Verified: all 7 indexes are present with the expected keys and options".

**4. App role.** Follow "Steps in Atlas" above. Then:
```powershell
node scripts/check-db-role.js --database Forex_elearning
```
This must print `PASS`, with no `FAIL … grants more than the role` lines.

**5. Shared rate limit.** In Render (and Vercel, if step 0 says so), set `SHARED_RATE_LIMIT=mongodb` and save; the service restarts. Repeat the step 2 checks.

**6. Signed-in checks S1–S8** (`browser-verification-checklist.md`) are run by the owner, against production with the owner's own accounts. No checkout and no payment.

**7. Record** each result (time, PASS or FAIL, no values) in the last section of `release-readiness-2026-10-26.md`.

**Rollback at any step:**
- **Code:** redeploy the previous commit `453f813` from the Render dashboard (**Manual Deploy → deploy a specific commit**).
- **Indexes:** run `--rollback`.
- **Role:** give the app user `readWrite` again.
- **Shared limit:** remove `SHARED_RATE_LIMIT`.
