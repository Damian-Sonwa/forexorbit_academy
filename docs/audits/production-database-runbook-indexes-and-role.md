# Production database: unique indexes and app role (D2/D3, D9)

**Status (28 October 2026):**
- **Dev database:** done. The six unique indexes are built and verified on `Forex_elearning_dev`.
- **Production:** not done. It needs the project owner, who holds the Atlas and production credentials. The agent has none and must not use them.

The application stays **NOT PRODUCTION-READY** until this runbook is completed and the other release blockers are closed.

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

**No disposable rehearsal.** No local `mongod` or Docker was available, so the throwaway-database rehearsal in section 5 of the index migration plan was not run. Without a second database, there was also no cross-process concurrency test against real MongoDB. The dev database (5 payment rows) served as the first real build.

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

1. **Deploy the application code first.** The live site runs older code (`main`) that lacks the duplicate-key handling in `createCourseIntent` and `releaseIntent`. Building I2 under that code would turn concurrent checkouts into errors. Deploying needs the release blockers closed and your approval.
2. **Back up.** Take an Atlas snapshot (or confirm continuous backup) of the production cluster.
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
   The user needs `createIndex` on the payment collections. The current app user (`readWrite`) has it, so do this **before** step 3 of the role section below. Otherwise, use a separate maintenance user.
6. **Check the result.** The script verifies every index after building. Afterwards, watch the logs for `E11000` for a week.
7. **Clean up the shell:** `Remove-Item Env:MONGO_URI`.

**Rollback:** `node scripts/course-payment-indexes.js --database Forex_elearning --rollback` drops only these six indexes by name. It changes no documents.

## Production: app role (D9)

**Goal:** the app user can read and insert audit entries, but cannot update, delete or drop them. MongoDB privileges add up, so the built-in `readWrite` role must be removed, not just supplemented.

The privilege list is generated from `lib/app-database-role.js`. A test fails if the app starts using a collection the list doesn't cover. Print it without connecting:

```powershell
node scripts/check-db-role.js --database Forex_elearning --print-role
```

It contains:
- `find`, `insert`, `update` and `remove` on each of the 45 app collections;
- `find` and `insert` only on `adminAuditLog`;
- `createCollection` and `createIndex` on the three consultation collections (used by the admin "seed experts" route);
- `listCollections` on the database.

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
| Deploy the app code that handles duplicate keys, then build I1–I6 on production | Owner, after release approval |
| Atlas custom role and app user switch, then the checker reports `PASS` | Owner (Atlas access) |
| Optional: apply the same role to `forexorbit_dev` for parity | Owner (Atlas access) |
| Cross-process concurrency test on real MongoDB (plan section 5) | Needs a disposable `mongod` |
