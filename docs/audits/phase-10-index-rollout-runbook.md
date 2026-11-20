# Phase 10 production rollout runbook: indexes, A4, market, verification, cleanup

**Owner-executed. Nothing in this document has been run against production.**

Every production command is labelled:
- **READ-ONLY**: lists, counts or explains. It changes nothing.
- **MODIFIES PRODUCTION**: needs explicit owner approval at its gate.

Each modifying step says what it changes, its preconditions, the expected result, how to verify it, and what to do if it fails.

Target:
- Atlas database `Forex_elearning`, MongoDB 8.0.39.
- State audited on 2026-11-20 by a read-only inspection with the temporary indexer user.

Tooling:
- **Branch:** `feat/phase-10-practice-trading`, the working tree containing `lib/index-plan.js` and `scripts/quiz-lesson-unique.js`.
- **Connection:** every script reads `MONGO_URI` (falling back to `MONGODB_URI`) and never prints it.
- **Precedence:** a variable set in the shell wins over `.env`, because dotenv never overrides. Set connection strings for one session only, and clear them afterwards. Never paste them into chat, logs or this file.

**Warning:** while `.env` holds a production URI, **any** script, test or `node server.js` started from this worktree without its own `MONGO_URI` connects to production.
- The acceptance harness blanks every `.env` key it doesn't set (`scripts/acceptance/guard.js`, `shieldLocalEnv`).
- The real-MongoDB tests use only `MONGODB_URI_TEST`.
- Nothing else is protected, so remove the production URI from `.env` as soon as Stage F is done.

## Credentials (keep them separate)

| Purpose | User | Role | Used in |
| --- | --- | --- | --- |
| Application | `forexorbit_app` (Render) | `forexorbitAppRole`, generated in `docs/audits/atlas/` | Never on the operator's machine, except A4 below |
| Index builds | `forexorbit_phase10_indexer`, temporary | `forexorbitLearningIndexRole`: `find`, `listIndexes`, `createIndex`, plus database `listCollections` | A3, C1, C2, C4, C5 |
| A4 conversion | `forexorbit_a4_converter`, temporary, created in B3 | `forexorbitA4ConvertRole`: `collMod`, `find`, `listIndexes` on `quizzes`, plus `listCollections` | C3 only |
| Market creation | an operator account, or the application user, holding `forexorbitAppRole` writes on the market collections | | D2 only |
| Role checks | the user being checked | | A2 |

## Stage A: production preflight (all READ-ONLY)

**A1. Database and version.** In Atlas, under Cluster, check:
- the cluster runs MongoDB **8.0.x** (8.0.39 when audited);
- `Forex_elearning` is the application's database;
- the backup state: the last snapshot time, or that Cloud Backup is unavailable on the tier.

Take an on-demand snapshot if the tier supports it. Without Cloud Backup, use `mongodump --db Forex_elearning` with an operator credential.

Recovery options:
- **An index built by mistake** can be dropped by the owner (`dropIndex`). The indexer can't.
- **An empty collection created by `--apply`** can be dropped by the owner.
- **A4 after C3 can't be undone by `collMod`.** See C3.

**A2. Application role (blocker).** Production has run `cbab33a` since 2026-11-06. The recorded state is that `forexorbitAppRole` was **not** updated for the 15 newer collections, so writes to them may be failing live:
- `learningDays`, `learningMinutes`;
- `quizAttempts`, `quizAttemptCounters`;
- the 11 trading and market collections.

With the **application** credential, in a one-off shell:
```
node scripts/check-db-role.js --database Forex_elearning            # READ-ONLY: sends only connectionStatus
```
- **Expected:** `user: forexorbit_app`, then `PASS`.
- **A `FAIL … lacks` line:** Stage B1 is required before anything else.

**A3. Index state**, with the indexer credential (the `.env` entry):
```
node scripts/trading-indexes.js    --database Forex_elearning
node scripts/learning-indexes.js   --database Forex_elearning
node scripts/assessment-indexes.js --database Forex_elearning
node scripts/check-db-role.js      --database Forex_elearning   # expect user forexorbit_phase10_indexer; FAIL lines are expected (it is not the app role)
```

| Script | Exit | Must show |
| --- | --- | --- |
| trading | 0 | Every T row `missing` or `no collection`.<br>`Would build: T1 … T18`<br>`Would create collections: tradingPositions, tradingOrders, tradingOperations, marketQuotes, marketCheckpoints, marketIncidents` |
| learning | 0 | `L1 … present (covered by the prefix of existing progress_user_course)`<br>`L2 … present (satisfied by existing lessons_course_order)`<br>`L3 … present (satisfied by existing quizscores_user_course)`<br>`Would build: L4 … L9`<br>`Would create collections: learningDays, learningMinutes` |
| assessment | **1** | `A4 quizzes quiz_lesson: conflicting (quizzes_lesson (same key): unique false (required true))`<br>`Blocked: A4`<br>A1, A2 and A3 `no collection`; A5 and A6 `missing` |

**A4. Stop conditions.** Stop if the state differs materially from that audit:
- any other `conflicting` row, or any `duplicate group(s)`;
- one of the 10 collections already exists, or an index is already present;
- the version isn't 8.0.x.

Several of these collections are created on the application's first write, so a collection that exists now means Phase 8–10 writes succeeded after all. Re-run the report, record the new state, and get a fresh approval.

Keep all outputs as the "before" record. They contain no credentials.

## Stage B: permissions (Atlas UI; each item MODIFIES PRODUCTION access)

**B1. Application role** (only if A2 failed).
- **What:** replace the `forexorbitAppRole` privileges with `docs/audits/atlas/forexorbitAppRole.atlas-admin-api.json`, through the Atlas custom roles UI or the Admin API. It grants:
  - find/insert/update/remove on 62 collections;
  - find/insert only on `adminAuditLog`, `tradingLedger` and `marketIncidents`;
  - createCollection/createIndex on the 3 consultation collections;
  - database `listCollections`.
- **Precondition:** `node scripts/atlas-role.js --database Forex_elearning --check` passes locally, so the JSON matches the code.
- **Verify:** re-run A2 until it prints `PASS`. The role change applies to new connections, and Render's app reconnects on its own.
- **If it fails:** the Atlas role editor keeps the previous version. Restore the earlier privilege list.

**B2. Narrow the indexer** (recommended before Stage C).
- **What:** replace `forexorbitLearningIndexRole` with `find`, `listIndexes` and `createIndex` on exactly these **22** collections, plus database `listCollections`:
  - `assignmentSubmissions`, `demoTaskSubmissions`, `demoTasks`, `demoTradeJournal`
  - `learningDays`, `learningMinutes`, `lessons`, `marketCheckpoints`
  - `marketIncidents`, `marketQuotes`, `notifications`, `progress`
  - `quizAttempts`, `quizScores`, `quizzes`, `tradingAccountSlots`
  - `tradingAccounts`, `tradingLedger`, `tradingOperations`, `tradingOrders`
  - `tradingPositions`, `users`
- **Why:** this removes bulk read access to the 10 collections no index script reads:
  - `certificates`, `courses`, `lessonPurchases`, `marketDataSets`, `marketHealth`
  - `paystackRefunds`, `quizAttemptCounters`, `rateLimits`, `sessions`, `userLessonAccess`

  Holding all session tokens and refund records is unnecessary exposure for an index user.
- **Evidence:** on an auth-enabled local MongoDB 8.0.38, this exact 22-collection role ran every report, all three `--apply` runs in order and the idempotent reruns. It was refused rollback, `dropIndex`, `collMod`, document writes, dropping collections, and reading `sessions`.
- **Verify:** re-run A3. It should give the same output.

**B3. Temporary A4 converter** (just before C3).
- **Role** `forexorbitA4ConvertRole`, with no inherited roles:
  ```json
  {
    "roleName": "forexorbitA4ConvertRole",
    "actions": [
      { "action": "COLL_MOD",         "resources": [{ "cluster": false, "db": "Forex_elearning", "collection": "quizzes" }] },
      { "action": "FIND",             "resources": [{ "cluster": false, "db": "Forex_elearning", "collection": "quizzes" }] },
      { "action": "LIST_INDEXES",     "resources": [{ "cluster": false, "db": "Forex_elearning", "collection": "quizzes" }] },
      { "action": "LIST_COLLECTIONS", "resources": [{ "cluster": false, "db": "Forex_elearning", "collection": "" }] }
    ],
    "inheritedRoles": []
  }
  ```
- **User:**
  - `forexorbit_a4_converter`, generated password;
  - this role only;
  - **Temporary User** with the shortest expiry (6 hours);
  - restricted to the cluster.
- **Evidence:** on auth-enabled 8.0.38, this role was enough for the report, `prepareUnique`, the `dryRun` and `unique: true`. It was denied insert, update, delete, `dropIndex`, `createIndex`, `collMod` on another collection and `find` on another collection.
  - Without `listCollections`, the script's preflight refuses with `lacks listCollections (database)`.
  - The indexer's role (no `collMod`) is refused by the preflight before anything is sent. The server returns `Unauthorized` for `collMod` and for its `dryRun`.
- **Revoke:** in Stage F1, or immediately if C3 is abandoned.

## Stage C: indexes, in this order

Before C1, use the indexer credential with no session override: `Remove-Item Env:MONGO_URI -ErrorAction SilentlyContinue`.

**C1. Trading indexes T1–T18** (MODIFIES PRODUCTION)
```
node scripts/trading-indexes.js --database Forex_elearning --apply
```
- **Changes:**
  - 18 indexes (section "Index reference");
  - creates 6 empty collections: `tradingPositions`, `tradingOrders`, `tradingOperations`, `marketQuotes`, `marketCheckpoints`, `marketIncidents`.
- **Precondition:** A3 trading exited 0 with no duplicate groups.
- **Expected:** `Built: T1, …, T18.` then `Verified: every index is present.`, exit 0.
- **Verify:** re-run the report. Every row should be `present` with `Would build: nothing.`
- **If it fails:**
  - `Refusing to apply` means nothing was built.
  - `Build of Tn failed (<code>). Built before the failure: …` means those indexes stay and are harmless.
  - In both cases, re-run the report, record it and stop.
  - A rerun after the cause is fixed builds only what's missing.

**C2. Learning indexes L4–L9** (MODIFIES PRODUCTION)
```
node scripts/learning-indexes.js --database Forex_elearning --apply
```
- **Changes:**
  - 6 indexes;
  - creates `learningDays` and `learningMinutes`.
  - `perf_progress_user`, `perf_lessons_course_order` and `perf_quizscores_user_course` are **not** created, because L1, L2 and L3 are satisfied by the existing indexes.
- **L9 is a TTL index:** minute rows are deleted 90 days (7,776,000 s) after `at`, which is a `Date` set to the minute in `lib/learning-activity.js`. This is the documented Phase 8 retention; daily totals live in `learningDays`.
- **Expected:** `Built: L4, L5, L6, L7, L8, L9.` then `Verified: every learning index is present.`, exit 0.
- **Verify and failure handling:** as in C1.
- **Never** run `--rollback` in production. The indexer has no `dropIndex` anyway.

**C3. A4: convert `quizzes_lesson` to unique in place** (MODIFIES PRODUCTION; separate owner operation)

- **Preconditions:**
  - B3 has been done;
  - A3 showed A4 as `conflicting` only because the index isn't unique.
- **Connection, this shell only, never in `.env`** (PowerShell):
  ```
  $s = Read-Host 'A4 converter URI' -AsSecureString
  $env:MONGO_URI = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  ```

1. **Report** (READ-ONLY): `node scripts/quiz-lesson-unique.js --database Forex_elearning`
   - Expect:
     - `A4 quizzes.quizzes_lesson {"lessonId":1}: non-unique`
     - `Data: 34 document(s); 0 duplicate group(s); 0 null or missing lessonId; 0 not string. Clean.`
     - `Signed-in user: may run the conversion steps.`
     - `Next: --prepare.`
     - exit 0
   - The document count may have grown since the audit. Any other stage, unclean data, or a user who can't run the steps: **stop**.
2. **Prepare** (MODIFIES PRODUCTION): `node scripts/quiz-lesson-unique.js --database Forex_elearning --prepare`
   - **Changes:** `collMod {index: {name: "quizzes_lesson", prepareUnique: true}}`. New duplicate `lessonId` writes are rejected with E11000 from now on; existing documents are untouched.
   - **Expected:** `prepare: OK; now prepared.`, exit 0. The script has verified the stage and that no other index or collection option changed.
   - **The application keeps working:** a quiz save is an upsert on `lessonId`, which the server retries. The route also retries once on E11000 (`lib/quiz-store.js`).
3. **Report** (READ-ONLY). Expect `prepared` and `Clean.`
4. **Convert** (MODIFIES PRODUCTION, **irreversible by `collMod`**): `node scripts/quiz-lesson-unique.js --database Forex_elearning --convert`
   - **Changes:** the script re-checks the data, then runs `collMod … unique: true` with `dryRun: true`. If any duplicate exists it refuses with `CannotConvertIndexToUnique` and changes nothing. Otherwise it converts.
   - **Expected:** `convert: OK; now unique.`, exit 0.
   - **Undoing it later** would need dropping and recreating the index non-unique: an owner decision outside this plan.
5. **Report** (READ-ONLY). Expect `unique` and `Done: the index is unique.`
6. Run `Remove-Item Env:MONGO_URI`, then do F1 (revoke).

**Interrupted A4: run the report first, always.**

| Stage | Meaning | Safe next step |
| --- | --- | --- |
| `non-unique` | Prepare never applied. | `--prepare`, or stop. |
| `prepared` | Prepare applied, convert didn't. **Safe to leave as it is:** reads and saves work, and only new duplicates are rejected. | `--convert`, or `--abort`, which returns to non-unique with `prepareUnique: false`. |
| `unique` | Done. | Nothing. `--convert` again changes nothing; `--abort` refuses. |
| `unexpected`, `absent` or `no collection` | Someone changed the index. | **Stop.** No step. Owner review. |

- **`--convert` refused with `data not clean` or `CannotConvertIndexToUnique`:** a duplicate exists, written before prepare took effect. The index stays `prepared` and nothing changed. Resolving duplicate quizzes is a separate, owner-approved data decision; this tooling never deletes or merges documents.
- **A failed command or dropped connection:** the script exits 1 with `A4 conversion failed (<code>)`. Each `collMod` is atomic, so the stage is whatever the server committed. Run the report.

**C4. Assessment indexes A1–A3, A5, A6** (MODIFIES PRODUCTION), with the indexer again, after `Remove-Item Env:MONGO_URI`.
```
node scripts/assessment-indexes.js --database Forex_elearning            # READ-ONLY first
node scripts/assessment-indexes.js --database Forex_elearning --apply
```
- **Precondition:** the report shows `A4 quizzes quiz_lesson: present (satisfied by existing quizzes_lesson)` and exits 0.
- **Changes:**
  - 5 indexes;
  - creates `quizAttempts` and `assignmentSubmissions`;
  - A1, A2 and A5 are unique, and A5 is partial on `attemptId` being a string, so old scores without one are left out.
- **Expected:** `Built: A1, A2, A3, A5, A6.` then `Verified: every index is present.`, exit 0.
- **If it fails:** as in C1.

**C5. Post-index verification** (READ-ONLY): run the three reports and the A4 report again.
- All exit 0.
- Every row is `present`, and L1, L2, L3 and A4 carry their `satisfied by` / `covered by` notes.
- `Would build: nothing.`
- No `no collection` rows.

To confirm the 10 new collections are empty and plain (mongosh, any read-capable user):
```
["tradingPositions","tradingOrders","tradingOperations","marketQuotes","marketCheckpoints","marketIncidents","learningDays","learningMinutes","quizAttempts","assignmentSubmissions"]
  .forEach(n => print(n, db.getCollectionInfos({name: n}).length, JSON.stringify(db.getCollectionInfos({name: n})[0].options)))
```
Each should print `<name> 1 {}`. Unless the app wrote first, the counts are 0 right after C1–C4.

## Stage D: synthetic market (MODIFIES PRODUCTION, separate approval)

**D1. Preconditions:**
- C5 is clean, including T8, T11 and T12 on the market collections;
- A2 prints PASS, so the app can write the market collections;
- no active market exists.

The market is our own deterministic synthetic market (`lib/market/`). It has no live data provider and six instruments: EUR/USD, GBP/USD, AUD/USD, USD/JPY, USD/CAD and USD/CHF. Prices are labelled `SIMULATED MARKET — NOT LIVE MARKET DATA`.

**D2. Create it**, with a credential that can write `marketDataSets`, `marketHealth`, `marketCheckpoints` and `marketIncidents` (the application user or an operator), set for this shell only. The start must be on the hour, in the past: about 30 days back gives chart history.
```
node scripts/market-init.js --database Forex_elearning --start <YYYY-MM-DDT00:00:00Z>           # READ-ONLY
node scripts/market-init.js --database Forex_elearning --start <YYYY-MM-DDT00:00:00Z> --apply   # MODIFIES PRODUCTION
```
- **Read-only output:** `Market simulated-market-1, from <start>. Report only: nothing written.` then `{"ok":true,"created":false}`.
- **Changes:**
  - one `marketDataSets` document: `_id simulated-market-1`, `kind synthetic`, a random seed generated in memory and **never printed**;
  - its `marketHealth` document;
  - checkpoints for the six instruments from the start time up to now.
- **Expected:** `{"ok":true,"created":true,"status":"ACTIVE"}`, exit 0.
- **If it exits 1** with `{"ok":false,…,"status":"RECOVERING"|"INITIALISING"}`: catch-up was interrupted or not finished. Re-run the same `--apply`. A rerun never replaces the market document; it finishes catch-up with the same pass the server runs every 15 seconds.
- **`ERROR` (history mismatch) or `SUSPENDED`:** **stop.** Only the Super Admin can resume, from the admin market page (`POST /api/admin/market`), after review.

**D3. Verify** (READ-ONLY):
- **Rerun** the read-only command. Expect `Market simulated-market-1 already exists. Status: ACTIVE. Nothing to create.` and `{"ok":true,"created":false,"status":"ACTIVE"}`.
- **mongosh:**
  ```
  db.marketDataSets.countDocuments()                      // 1
  db.marketDataSets.findOne({}, {seed: 0})                // kind "synthetic", active true, six instruments
  db.marketHealth.findOne()                               // status "ACTIVE", recent heartbeatAt
  db.marketCheckpoints.aggregate([{$group: {_id: "$instrument", n: {$sum: 1}}}])   // six instruments
  db.marketIncidents.countDocuments()                     // 0
  ```

**Evidence:** local tests on MongoDB 8.0.38 (`tests/integration/market-init-mongo.test.js`, 4 tests) covered a fresh database, reruns, a second market (refused), an interrupted initialisation, a suspended market, and the 15-second pass moving prices forward across a separate connection.

## Stage E: live application verification

**E0. Deploy order.**
- The remediation code (F1/F4/F5/F8, the equivalence logic, A4 tooling and the history sorts) must be deployed **after** C1, because the new sweep relies on T17/T18.
- If market creation (D) happens before that deploy, the live checks below run on `cbab33a` and must be **repeated** after the deploy.

Checks (READ-ONLY unless noted):

1. **Health:** the production health endpoint returns OK with the database ping true. The app log has no `tradingEvaluator … failed` lines.
2. **Market:** as a student test account, the trading page shows the six instruments with the SIMULATED label, and quotes change between refreshes during market hours.
3. **Controlled trade** (MODIFIES PRODUCTION, test data; approval needed). With a **student** test account (staff can't trade; the routes are student-only):
   - open the practice account and check its starting balance;
   - place a small market order, then check the position and the ledger rows;
   - place and cancel a limit order;
   - close the position, then check the realised P/L in the ledger and the balance.
4. **Isolation:** a second student can't see the first student's account, orders or positions. A direct API call with the other account's id returns 403 or 404.
5. **Recovery and sweep:**
   - `node scripts/trading-reconcile.js --database Forex_elearning` (READ-ONLY, with an operator credential) exits 0 with no mismatches and no failures;
   - the app log shows no `tradingEvaluator … partial` lines.
6. **Learning and assessments:**
   - a quiz save by an instructor returns 200 or 201;
   - a student quiz attempt is recorded in `quizAttempts`;
   - learning time appears in `learningDays`.
7. **Logs:** search Render's logs for `mongodb://`, `mongodb+srv://`, `seed` and `PAYSTACK_SECRET`. There should be no matches.

**Containment if a check fails:**
- **Market:** the Super Admin suspends it from the admin page; trading closes and data stays.
- **Code:** redeploy the previous commit, `cbab33a`, which is compatible with every index built here.
- **Indexes:** none needs removing for a rollback.
- **A4:** stays unique. That is safe for `cbab33a`, whose quiz save is the same upsert.

## Stage F: cleanup

1. **Converter:** delete the user `forexorbit_a4_converter`, then the role `forexorbitA4ConvertRole`.
2. **Indexer:** delete `forexorbit_phase10_indexer` and `forexorbitLearningIndexRole`. If more index work is planned, keep only the B2 narrow role.
3. **Local:** remove the production URI from the local `.env` and restore the normal local configuration. Clear any session variables.
4. **Atlas:** under Database Access, only the expected users remain. A2 still prints PASS for `forexorbit_app`.
5. **App:** the production application still works on its own credentials (re-run E1 and E2).

## Index reference (33 definitions)

None of these has a collation, sparse or hidden flag. The only TTL is L9; the only partial filter is A5.

| ID | Collection | Name | Key | Options | Production action |
| --- | --- | --- | --- | --- | --- |
| L1 | progress | perf_progress_user | `{userId:1}` | | none: covered by the prefix of unique `progress_user_course` |
| L2 | lessons | perf_lessons_course_order | `{courseId:1, order:1}` | | none: satisfied by `lessons_course_order` |
| L3 | quizScores | perf_quizscores_user_course | `{userId:1, courseId:1}` | | none: satisfied by `quizscores_user_course` |
| L4 | notifications | perf_notifications_user_recent | `{userId:1, createdAt:-1}` | | build |
| L5 | demoTradeJournal | perf_journal_student_recent | `{studentId:1, createdAt:-1}` | | build |
| L6 | progress | perf_progress_course_rank | `{courseId:1, progress:-1}` | | build |
| L7 | users | perf_users_role_points | `{role:1, points:-1}` | | build |
| L8 | learningDays | perf_learning_days_user | `{userId:1, day:-1}` | | build; creates the collection |
| L9 | learningMinutes | ttl_learning_minutes | `{at:1}` | TTL 7,776,000 s | build; creates the collection |
| A1 | quizAttempts | quiz_attempt_user_lesson_number | `{userId:1, lessonId:1, number:1}` | unique | build; creates the collection |
| A2 | assignmentSubmissions | assignment_submission_user_assignment | `{userId:1, assignmentId:1}` | unique | build; creates the collection |
| A3 | quizAttempts | quiz_attempt_lesson_results | `{lessonId:1, status:1, submittedAt:-1, _id:-1}` | | build |
| A4 | quizzes | quiz_lesson | `{lessonId:1}` | unique | convert existing `quizzes_lesson` in place (C3) |
| A5 | quizScores | quiz_score_attempt | `{attemptId:1}` | unique, partial `{attemptId:{$type:"string"}}` | build |
| A6 | quizScores | quiz_score_user_recent | `{userId:1, createdAt:-1, _id:-1}` | | build |
| T1 | tradingPositions | trading_position_account_status | `{accountId:1, status:1}` | | build; creates the collection |
| T2 | tradingPositions | trading_position_user_recent | `{userId:1, status:1, openedAt:-1, _id:-1}` | | build |
| T3 | tradingOrders | trading_order_account_status | `{accountId:1, status:1}` | | build; creates the collection |
| T4 | tradingOrders | trading_order_user_recent | `{userId:1, createdAt:-1, _id:-1}` | | build |
| T5 | tradingOperations | trading_operation_status | `{status:1, createdAt:1}` | | build; creates the collection |
| T6 | tradingLedger | trading_ledger_account_seq | `{accountId:1, seq:1}` | unique | build |
| T7 | tradingLedger | trading_ledger_account_recent | `{accountId:1, createdAt:-1, seq:-1}` | | build |
| T8 | marketQuotes | market_quote_dataset_instrument_time | `{datasetId:1, instrument:1, time:1}` | unique | build; creates the collection |
| T9 | tradingAccounts | trading_account_user | `{userId:1}` | | build |
| T10 | tradingAccountSlots | trading_slot_leaderboard | `{leaderboardOptIn:1}` | | build |
| T11 | marketCheckpoints | market_checkpoint_series | `{datasetId:1, instrument:1, step:-1}` | unique | build; creates the collection |
| T12 | marketIncidents | market_incident_recent | `{marketId:1, createdAt:-1}` | | build; creates the collection |
| T13 | tradingOperations | trading_operation_user_recent | `{userId:1, status:1, executedAt:-1, _id:1}` | | build |
| T14 | demoTasks | demo_task_assignee_recent | `{assignedTo:1, createdAt:-1}` | | build |
| T15 | demoTaskSubmissions | demo_submission_task_student | `{taskId:1, studentId:1}` | | build |
| T16 | demoTaskSubmissions | demo_submission_student_recent | `{studentId:1, submittedAt:-1}` | | build |
| T17 | tradingPositions | trading_position_status_account | `{status:1, accountId:1}` | | build (sweep) |
| T18 | tradingOrders | trading_order_status_created | `{status:1, createdAt:1}` | | build (sweep and recovery) |

A3, A6, T2, T4, T7 and T13 end with the application's own tie-breaker, from `lib/quiz-attempts.js` and `lib/trading/views.js`. Without it, a results or history page fetched and sorted that lesson's or student's whole history in memory.
- The A3 results queue took 3,600 documents for one page.
- History pages took one student's full history, 3,000 rows.

With the tie-breaker, a page reads about one page of keys. None of these six indexes exists in production yet, so this changes nothing there.

**Another environment that already built them with the older keys** (any database other than production, such as a developer database or a reused acceptance database):
- The report shows, for example, `A3 … conflicting (quiz_attempt_lesson_results exists with key {"lessonId":1,"status":1,"submittedAt":-1} (required …))`, and `--apply` refuses.
- The owner of that database drops the old index by name and re-runs `--apply`. That is what was done for the local acceptance databases on 2026-11-20.
- The scripts never do this themselves.

## Evidence summary

**MongoDB 8.0.38**, the newest public 8.0 build: 8.0.39 isn't downloadable. Checked locally against both a no-auth replica set and an auth-enabled server:
- the `collMod` sequence, its errors, idempotency and irreversibility;
- the permission enforcement of B2 and B3;
- every real-MongoDB suite, including `test:mongo:indexes` (8 tests) and `tests/integration/market-init-mongo.test.js` (4).

**MongoDB 9.0.4:** the same suites, plus the browser acceptance suites.

**Production E1** (`progress_user_course`) was converted to unique in place the same way during Phase 6.
