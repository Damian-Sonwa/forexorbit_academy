# ForexOrbit Academy — Legacy Course Access Impact Report

Date: 27 October 2026
Status: **Executed** (read-only), 27 October 2026 14:50 UTC.
Scope: which existing students lose or keep course access under the Phase 1 rules (full-course access only from a paid course purchase or an explicit complimentary or manual grant).

No record was inserted, updated, or deleted. No index, setting, payment, refund, webhook, or deploy was touched. The Phase 1 implementation was not modified. No access was granted.

> **Configuration note (added later on 27 October 2026).** Sections 1 to 7 describe the local `.env` as it was **when this report and the section 7 verification ran**: it reached the shared `Forex_elearning` database and held a live Paystack secret key. That configuration has since been replaced. Section 8 records the current, isolated development setup. The historical findings, including the unresolved backfill purchase `fo_1…gow7`, are unchanged.

---

## 1. Result

**No student loses or has reduced access under the new rules.**

| Category | User–course pairs | Students |
|---|---|---|
| Verified full-course purchasers (paid course row with a matching successful payment) | 2 | 2 |
| Paid course row with no matching payment | 0 | 0 |
| Explicit complimentary or manual grant | 0 | 0 |
| Lesson-only purchases (old rules gave the whole course) | 0 | 0 |
| Course rows without a `paid` field (old rules counted them as paid) | 0 | 0 |
| Students who may lose any course or lesson access | — | **0** |
| Records that cannot be classified reliably | 0 | 0 |
| Staff rows (staff bypass payment, unaffected) | 0 | 0 |

Database totals: 59 users, 6 courses, 34 lessons, 2 `userCourseAccess` rows, 2 `coursePurchases` rows, 2 successful `paystackPayments` rows. The `userLessonAccess` and `lessonPurchases` collections **do not exist** in this database, so no lesson-purchase records are affected.

Other checks:

- Successful course payments with no current entitlement (charged but locked): **0**.
- Both successful payments are **₦5,000 (500000 kobo) NGN**, the old price. Both purchasers keep full access; the new price applies only to new checkouts.
- All 34 lessons store `courseId` as a string, so the old lesson-to-course rule would have matched them as expected.
- Rows with non-string user or course IDs: 0.

### Item for manual review

One of the two verified purchasers has `source: paystack-paystack-backfill`. The record was written by the old `backfill-old-payment.js` operator script, which wrote the access row, the payment row, and the purchase row together **without asking Paystack**. Its payment-ledger match therefore is not independent evidence. The other row has `source: paystack-verify-api` (server-verified at the time).

This report does not change that record. Section 7 records the Paystack verification: the charge is real and the amount matches, but the customer and course association **does not match** the local record.

---

## 2. Database environment and safety

- **Target (historical configuration, see section 8 for the current one):** the database configured in the local `.env` at the time. It was a remote SRV (Atlas-style) cluster with database `Forex_elearning`. This name comes from the app default because `MONGODB_DB_NAME` is not set. This is the shared database named in the course purchase audit. No host, user name, or connection string is recorded here.
- **Identity checks before any query:**
  1. The script prints the environment class and database name, and stops unless `LEGACY_REPORT_CONFIRM_DB` equals that name. A dry start without it exited before connecting.
  2. After connecting it lists collection names and stops if `users`, `courses`, or `lessons` is missing. All were present (31 collections).
- **Read-only enforcement:** the credential has write privileges (`connectionStatus` reported `credentialCanWrite: true`). Read-only behavior is therefore enforced by the script, not by the server:
  - **Allowed operations:** the only database handle allows `listCollections`, `find` with a field projection, and the `ping` and `connectionStatus` commands. Any other command is refused.
  - **Connection settings:** `readPreference: secondaryPreferred`, `retryWrites: false`, pool size 2.
  - **Source checks:** `tests/legacy-course-access-report.test.js` checks the script source for every write-capable call (insert, update, replace, delete, findOneAnd*, bulkWrite, createIndex, drop, aggregate, `$out`, `$merge`, rename, createCollection) and confirms the command allowlist rejects writes.
- **Personal data:** projections read only IDs, roles, payment status fields, amounts, and sources. No email, name, or phone field was read. The output contains counts only; a test asserts that no user ID or reference appears in it. Errors print only the error name and code.

A read-only database user would be safer for future reports. That requires an Atlas change and was not made.

---

## 3. Query logic

Script: `scripts/legacy-course-access-report.js`. It loads the access collections with projections and classifies each user–course pair in memory with the pure function `classify`.

**Old rules (before Phase 1)**: a student had full-course access if any of these held:

- A. A `userCourseAccess` row with `paid: true` **or no `paid` field**.
- B. Any `userLessonAccess` row naming the course, with `paid: true` or no `paid` field.
- C. Any `lessonPurchases` row for a lesson whose stored `courseId` string is that course.

**New rules:** a `userCourseAccess` row with `paid: true`, or with `entitlementType` of `complimentary` or `manual_grant`. Legacy lesson rows unlock only their own lesson, and only `userLessonAccess` rows with `paid: true` count (any `lessonPurchases` row counts).

**Pair categories**, assigned in this order so each pair has exactly one:

1. User or course not found: unclassifiable.
2. Staff role: unaffected.
3. New rule grants access: verified when a successful `paystackPayments` row matches the pair or the row's reference; otherwise "paid flag, no ledger match". A grant without `paid: true` is an explicit grant.
4. Old rules granted access but the new rule does not: the pair loses access. It is labeled "unflagged course row" if rule A without `paid` applied, otherwise "lesson-only". Losing pairs are further split by payment evidence, by whether any single-lesson access remains, and by active enrollment.
5. Otherwise: no access before or after.

Also counted:

- **Lesson level:** `userLessonAccess` rows without a `paid` field. The earliest lesson unlocks (commit `159fc00`) were written without it and would lose even single-lesson access.
- **Ledger:** successful course payments with no current entitlement.
- **Data shapes:** values of the `paid` field, sources, lesson `courseId` types, and payment amounts.

**Source of the legacy patterns:** git history of every writer.

- `userLessonAccess` was written first without `paid` (`159fc00`), then with `paid: true` (`421ba2f`).
- `lessonPurchases` was written by the first lesson checkout (`e69f69c`).
- Every `userCourseAccess` writer, including the backfill script, set `paid: true`. A course row without `paid` could only come from a manual edit.

---

## 4. Validation and limitations

**Validation**

- The classifier was tested on synthetic rows covering every category, including unflagged lesson rows, unknown lessons, staff, missing users, withdrawn enrollment, non-string IDs, and a charged-but-locked payment: 10 tests, all passing, no database used.
- On the live run, the category sum equals the number of pairs (`categorySumMatchesPairs: true`).
- Row totals agree across collections: 2 access rows, 2 purchase rows, and 2 successful payments, all with the same amount.
- Absent collections were confirmed by `listCollections`, not inferred from zero rows.

**Limitations**

- A snapshot at one moment. Purchases made after 14:50 UTC are not included.
- "Verified" means a matching local ledger row, not a fresh Paystack lookup. No provider call was made.
- `paystackPaymentIntents` was not analysed. Pending intents at the old ₦5,000 amount stay confirmable at that amount only, as described in the purchase audit.
- Only the database in the local `.env` at the time (`Forex_elearning`) was read. Whether Render production uses this same cluster and database was not checked against hosting settings. If production uses a different database, run the script there with the same confirmation step. The current local `.env` points at the isolated dev database (section 8), so re-running the script locally today would not read `Forex_elearning`.
- Roles are read from the `users` collection. Users with no role are treated as students.

**Suggested manual review (not performed, no decision made)**

For the single backfill-sourced purchaser, an authorized operator could:

1. Look up its payment reference in the Paystack dashboard and confirm the charge is successful, NGN, ₦5,000, and for that student.
2. If confirmed, note the outcome in the support record. No database change is needed because access is already correct.
3. If it cannot be confirmed, raise it with the business owner. Do not revoke access without an agreed policy.

For any future run that reports losing or unclassifiable pairs:

- Review them case by case using the Paystack dashboard and support history.
- Record each decision.
- Apply any conversion to `entitlementType: manual_grant` only through a reviewed, approved operator process. This report does not do that.

---

## 5. How to re-run

```powershell
$env:LEGACY_REPORT_CONFIRM_DB = 'Forex_elearning'
node scripts/legacy-course-access-report.js
Remove-Item Env:LEGACY_REPORT_CONFIRM_DB
```

| Command | Result |
|---|---|
| `node --test tests/legacy-course-access-report.test.js tests/security-remediation.test.js` | 17 passed, 0 failed |
| `node scripts/legacy-course-access-report.js` (no confirmation) | Printed environment class and database name; stopped before connecting (exit 2) |
| `node scripts/legacy-course-access-report.js` (confirmation set) | Completed (exit 0); results in section 1 |

The test file `tests/legacy-course-access-report.test.js` has since been added to the `npm test` script (see the consolidated pre-release report).

---

## 6. Remaining release blockers

Release remains **BLOCKED**.

1. Review and approval of the uncommitted Phase 1 purchase changes, followed by a commit through the normal process.
2. Refund and dispute access policy (events are recorded only).
3. Unique indexes on `paystackPayments.reference` and `userCourseAccess { userId, courseId }`, through a reviewed migration tested on a disposable database first.
4. Hosting settings:
   - Remove the old price environment variables.
   - Confirm production runs with `NODE_ENV=production`, a live key, and the webhook pointed at the API origin.
   - Confirm which database production uses (see section 4).
5. Local isolation: **done for local development (section 8).** At the time of this report the local `.env` reached the shared database with a write-capable credential. It now uses the isolated `Forex_elearning_dev` database with a user limited to that database.
6. The backfill-sourced purchase is a verified live charge whose customer and course do not match the local record (section 7). It needs a business decision and support follow-up; access was left unchanged.
7. Support tooling for `paymentExceptions` (no admin view yet).
8. Rate limits are per process; multi-instance hosting needs a shared store.
9. Partly executed: a Paystack test-mode browser checkout succeeded and unlocked the course automatically on the dev database (see the consolidated pre-release report, section 2a). Not yet executed: real webhook delivery, failure and duplicate paths in test mode, MongoDB integration tests.
10. Disk space on the development machine is low (about 0.9 GB free). Not re-checked since.
11. Historical: at the time of this report the local `.env` held a live Paystack secret key and reached the production database with a write-capable credential. **This local configuration has been replaced (section 8).** Still open: the live key that was stored locally has not been confirmed rotated, and production hosting settings were not checked.

---

## 7. Backfill transaction verification (27 October 2026, 15:20 UTC)

Status: **executed, read-only. Result: the charge is genuine, but the customer and course association does not match.** No record was changed.

### 7.1 Configuration at the time (historical, values not displayed)

This table describes the local configuration on 27 October 2026 at 15:20 UTC. It is no longer current; see section 8.

| Item | Finding |
|---|---|
| `PAYSTACK_SECRET_KEY` | Set; **live** key prefix |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Not set locally, so the browser checkout cannot open locally |
| Webhook signing | Uses `PAYSTACK_SECRET_KEY`, as Paystack does; no separate secret needed |
| Database | Remote SRV cluster, database `Forex_elearning` (default name). Treated as production; local execution is **not** isolated |
| `NODE_ENV` in `.env` | Not set (local runs are development) |
| Local payment guard | `decidePaymentEnvironment` returns disabled, `live_key_outside_production`, so local checkout, confirm, and webhook routes return 503 and write nothing |
| Stale price variable | `PAYSTACK_LESSON_PRICE_KOBO` is present and ignored by the code |

### 7.2 Method

A one-off Node process, run from standard input and not saved, did the following:

- **Database:** `find` and `findOne` with field projections only, on `userCourseAccess`, `paystackPayments`, `coursePurchases`, `users`, and `courses`. Connection settings: `readPreference: secondaryPreferred`, `retryWrites: false`.
- **Paystack:** one `GET https://api.paystack.co/transaction/verify/:reference` through the existing `fetchPaystackTransaction`, with a 10-second timeout. No initialize, charge, refund, or webhook call was made.
- **Customer email:** compared in memory, case-insensitively. Only the true/false result was printed.
- **Reference:** printed masked only.

### 7.3 Results

Exactly one access row has `source: paystack-paystack-backfill`. Masked reference: `fo_1…gow7`.

| Check | Local records | Paystack | Match |
|---|---|---|---|
| Transaction exists | — | Found, `domain: live` | Yes |
| Status | access `paid: true`, payment `success`, purchase `paid` | `success`, paid 29 March 2026 | Yes |
| Reference | access, payment, and purchase rows share it | Same | Yes |
| Amount | 500000 kobo on all three rows | 500000 kobo (₦5,000) | Yes |
| Currency | NGN on all three rows | NGN | Yes |
| Metadata user ID | — | **Absent** | Cannot confirm |
| Metadata course ID | — | Present, **different course** from the local record | **No** |
| Customer email vs local student | — | Present | **No** |
| Customer email vs stored payment row email | — | Present | **No** |

The local student exists (role student), the local course exists, and the payment row names the same student and course as the access row.

### 7.4 Interpretation

- **Independently verified with Paystack:** a real, successful, live ₦5,000 NGN charge exists under this reference.
- **Amount and currency** match the existing purchase.
- **Customer association is not verified.** Paystack ties the charge to a different customer email and a different course from the ones the backfill script recorded. The backfill script took the user, course, and reference from operator input without checking Paystack, so one possible explanation is that the wrong student or course was entered. Others include a student paying under another email, or a shared reference. This review cannot tell which.

Per the instructions, verification stopped at this ambiguous result. Access, payment, and purchase records are unchanged. No further lookups were made, such as searching for the Paystack customer among local users.

### 7.5 Suggested follow-up (not performed, no decision made)

1. An authorized operator compares the Paystack dashboard entry for this reference (customer, course metadata, date) with support records and the student's account.
2. The business owner decides:
   - whether the current student is the rightful owner, and
   - whether a different student or course should hold this purchase.
3. Any correction goes through a reviewed operator process. The backfill script stays disabled. Access should not be revoked without the agreed policy.

### 7.6 Tests run (mocked or offline only)

These were run with outbound network blocked by a preload. The probe confirmed that a request to Paystack failed with "network blocked". The database and Paystack environment variables were blank for the run. No test loads `.env` or opens a database connection, and every provider lookup in the tests uses an injected fake `fetch`.

| Command | Result |
|---|---|
| `npm test` (includes the 39-test purchase suite: 35 behavioral tests against an in-memory database and mocked Paystack, plus 4 source-contract tests) | 257 passed, 0 failed |
| `node --test tests/legacy-course-access-report.test.js` | 10 passed, 0 failed |

Not run at that time: backfill or migration scripts, any API route against the configured database, live or sandbox checkout, refunds, webhook delivery. (These counts are historical. The current `npm test` baseline is in the consolidated pre-release report.)

---

## 8. Current local development environment (added 27 October 2026)

The historical configuration in sections 2 and 7.1 has been replaced by an isolated development setup. Checks were made by prefix or presence only; no value was displayed.

| Item | Current finding |
|---|---|
| `PAYSTACK_SECRET_KEY` | Set; **test** key prefix (`sk_test_`) |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Set; **test** key prefix (`pk_test_`). The browser checkout opens locally. |
| `MONGODB_DB_NAME` | `Forex_elearning_dev` |
| Database user | `forexorbit_dev`. `connectionStatus` with `showPrivileges` reports a single role, `readWrite` on `Forex_elearning_dev`, with no privileges on any other database. |
| `NODE_ENV` | Not set (development) |
| `.env.local` / machine-level overrides | None present |

What this means:
- Local scripts and the local server can no longer write to `Forex_elearning` with this credential.
- The dev database was filled by the guarded `scripts/seed-dev.js`, not from production data.
- A Paystack test-mode checkout has been completed against it (consolidated report, section 2a).

What it does not show:
- whether the dev database runs on the same cluster as production;
- which database and keys Render production uses;
- whether the live key once stored locally has been rotated.

**Unchanged by this update:** the historical evidence in sections 7.3 to 7.5. The backfill purchase `fo_1…gow7` (a real live ₦5,000 NGN charge whose Paystack customer and course metadata do not match the local record) is still **unresolved**. Its access, payment and purchase records were not read, altered, reassigned or revoked as part of this update, and the ownership decision in section 7.5 is still with the business owner.
