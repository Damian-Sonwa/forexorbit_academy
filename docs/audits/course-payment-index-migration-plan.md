# Course payment: unique index migration plan

**Status (28 October 2026):**
- **Dev database:** built. All six indexes are on the isolated dev database `Forex_elearning_dev`, after the scans came back clean.
- **Production:** not built. Production has no index and no scan run against it.
- **What's needed:** the owner-run steps are in `production-database-runbook-indexes-and-role.md`.
- **Implementation:** `scripts/course-payment-indexes.js` (dry run by default) and `lib/course-payment-indexes.js`.
- **Plan changes:**
  - I2's partial filter is now `{ status: 'pending', kind: 'course' }`, so legacy lesson checkouts are excluded;
  - I5 is full;
  - `releaseIntent` handles the duplicate key that I2 can cause.

The original plan follows.

Related findings: D2 (granting access is several writes with no unique indexes) and D3 (concurrent checkout can create two payable intents). See `docs/audits/consolidated-pre-release-remediation.md`.

## 1. What the code guarantees today, without indexes

| Guarantee | How | Holds across server processes? |
|---|---|---|
| One confirmation per reference at a time | Atomic compare-and-set "claim" on the intent's `_id` (`status` → `processing`) in `confirmCoursePayment` | **Yes.** `_id` is already unique, so the claim is a real cross-process lock. A stale claim (older than `CLAIM_TTL_MS`, 2 minutes) can be taken over. |
| A replayed callback/webhook for a granted reference does nothing | Settled `paystackPayments` row is read first; the claim serializes the rest | Yes for the same reference |
| One payment row per reference | Upsert keyed on `{ reference }` | **No.** Two concurrent upserts that both miss can insert two rows. The claim makes this unlikely for course payments (only the claim holder writes), but it is not a database guarantee. |
| One access row per student and course | `findOne` and then an upsert keyed on `{ userId, courseId }` | **No.** Two different references for the same student and course (two tabs, two charges) are claimed independently and can both upsert. |
| One pending intent per student and course | `createCourseIntent` reuses an unexpired intent and, after inserting, the later of two simultaneous inserts closes itself ("self-yield") | **No.** This narrows the race but cannot rule it out between processes. A second charge that slips through is caught by `findOtherEntitlement` and recorded as a `duplicate_payment` exception. It does not grant twice. |
| One exception per `{ reference, reason }` | Upsert plus a retry loop in `recordPaymentException` | No (same upsert race) |

The in-memory tests (`tests/course-purchase.test.js`, using a store that deliberately yields between read and insert) show the application guards work within one Node process. They do not show cross-process behavior. Only the indexes below can give that.

## 2. Proposed indexes

All indexes are additive. Names are fixed so rollback is a single `dropIndex` by name.

| # | Collection | Keys | Options | Closes | Prerequisite |
|---|---|---|---|---|---|
| I1 | `paystackPaymentIntents` | `{ reference: 1 }` | `unique: true`, name `uniq_intent_reference` | Duplicate intent references | Scan S1 clean |
| I2 | `paystackPaymentIntents` | `{ userId: 1, courseId: 1, kind: 1 }` | `unique: true`, `partialFilterExpression: { status: 'pending' }`, name `uniq_pending_intent_per_course` | D3 | Scan S2 clean; app code with the duplicate-key fallback deployed first (step 1 in section 7) |
| I3 | `paystackPayments` | `{ reference: 1 }` | `unique: true`, name `uniq_payment_reference` | D2 (payment rows) | Scan S3 resolved |
| I4 | `userCourseAccess` | `{ userId: 1, courseId: 1 }` | `unique: true`, name `uniq_access_user_course` | D2 (access rows) | Scan S4 resolved, with owner sign-off |
| I5 | `coursePurchases` | `{ userId: 1, courseId: 1 }` | `unique: true` (or partial on `{ status: 'paid' }` if the scan shows legitimate multi-row history), name `uniq_purchase_user_course` | D2 (purchase rows) | Scan S5 resolved; decision on full or partial |
| I6 | `paymentExceptions` | `{ reference: 1, reason: 1 }` | `unique: true`, name `uniq_exception_reference_reason` | Duplicate exception documents | Scan S6 resolved |

Not proposed:
- **`adminAuditLog`:** no new index. Append-only should be enforced with database roles (D9), not indexes.
- **`userLessonAccess` and `lessonPurchases`:** legacy, read-only for the course flow. They are left untouched.

Notes:
- **I2, pending intents without a `status` field:** legacy pending intents that have no `status` field are outside the partial filter. The code still treats them as pending. Scan S2 lists them so they can be expired (with approval) before I2 is relied on.
- **Upsert retries on I3, I4 and I6:** MongoDB 4.2+ retries an upsert that hits a duplicate key automatically when the query is an equality match on exactly the unique index's keys. The upserts in `grantCourseEntitlement` (`{ reference }`, `{ userId, courseId }`) and `recordPaymentException` (`{ reference, reason }`) are equality matches. Confirm the cluster version before relying on this.
- **Mixed id types:** some legacy rows may store `userId`/`courseId` as ObjectId rather than string. A unique index treats `"abc"` and `ObjectId("abc")` as different keys, so a mixed pair would not be caught. Scans S4 and S5 group by the string form to surface these.

## 3. Read-only duplicate scan

Run each scan with a **read-only** database user (built-in `read` role on the target database only), preferably against a restored snapshot rather than the live cluster. Output counts and masked identifiers only: reference as `first4…last4`, ids as the last 6 hex characters. Do not export documents, emails, or payer data.

```js
// S1, S3: duplicate references (run on paystackPaymentIntents, then on paystackPayments)
[{ $group: { _id: '$reference', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'duplicateReferences' }]

// S2: more than one open intent per student and course, including legacy rows without status
[{ $match: { kind: 'course', $or: [{ status: 'pending' }, { status: { $exists: false } }] } },
 { $group: { _id: { u: { $toString: '$userId' }, c: { $toString: '$courseId' } }, n: { $sum: 1 }, missingStatus: { $sum: { $cond: [{ $eq: [{ $type: '$status' }, 'missing'] }, 1, 0] } } } },
 { $match: { $or: [{ n: { $gt: 1 } }, { missingStatus: { $gt: 0 } }] } }]

// S4, S5: several rows for one student and course (string form catches mixed id types)
[{ $group: { _id: { u: { $toString: '$userId' }, c: { $toString: '$courseId' } }, n: { $sum: 1 }, types: { $addToSet: { $type: '$userId' } } } },
 { $match: { $or: [{ n: { $gt: 1 } }, { 'types.1': { $exists: true } }] } }]

// S6: duplicate exception keys
[{ $group: { _id: { r: '$reference', why: '$reason' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]
```

Record for each scan: collection, total documents, number of duplicate groups, and the masked keys of each group. That record is the input to section 4.

## 4. Resolving duplicates (needs owner decisions)

Nothing is deleted automatically. For each duplicate group:

1. **Choose a keeper.** For access rows, an entitled row (paid, `complimentary`, or `manual_grant`) is always kept. If several are entitled, keep the earliest and record the other references in `previousPaystackReferences` on the keeper. A grant is never downgraded.
2. **Archive, don't delete.** Copy each non-keeper document unchanged into `<collection>_duplicates_archive` together with `archivedAt`, `archivedBy` and `keeperId`. Only after that copy is verified is the original removed. Removing an access row needs explicit owner sign-off per group.
3. **Leave payment evidence alone.** For `paystackPayments`, two rows with one reference are the same charge. Keep the row with `entitlementApplied` set, and merge any held evidence into it.
4. **Don't touch the backfill purchase `fo_1…gow7`.** Its records are excluded from automatic resolution (see Phase G of the consolidated report).
5. **Re-run the scan** until every collection reports zero groups.

Each resolution is written as a reviewed script that defaults to dry-run, prints its planned actions using masked keys, and needs an explicit flag to write. That script does not exist yet and is not part of this change.

## 5. Disposable MongoDB rehearsal

The rehearsal runs on a database that is plainly disposable, never on the shared or production cluster:

- A local `mongod` (for example the official `mongo:7` container) bound to `127.0.0.1`, with a throwaway database named `fo_index_rehearsal_<date>`. `decidePaymentEnvironment` only allows payment code to run against a loopback URI or an isolated test environment.
- Seed with synthetic data that reproduces every duplicate shape found in section 3. Never use a raw production dump. If production-shaped data is needed, use an anonymized snapshot.
- No new npm dependency is needed. The rehearsal uses the existing `mongodb` driver.

Steps:
1. Seed the synthetic duplicates. Run scans S1–S6 and confirm they find exactly the seeded groups.
2. Run the resolution dry run, then the write mode, then re-run the scans and expect zero groups.
3. Create I1–I6, then call `listIndexes` and confirm the names and options.
4. Concurrency checks through the real driver:
   - 20 parallel `createCourseIntent` calls for one student and course must return a single reference, and exactly one pending intent must exist.
   - 10 parallel `confirmCoursePayment` calls across two different paid references for one student and course must leave one access row. The second reference must be held as a `duplicate_payment` exception.
   - Run the same calls in two separate Node processes against the same database.
5. Kill a process during `grantCourseEntitlement` (between the payment and access writes). Then retry and expect one complete record set (claim takeover after `CLAIM_TTL_MS`).
6. Drop the indexes, re-run step 4, and record the difference. This documents what the indexes add.

## 6. Rollback

- Indexes: `db.<collection>.dropIndex('<name>')` for each name in section 2. Dropping an index changes no documents.
- App code: the duplicate-key fallback in `createCourseIntent` runs only when an insert fails with error code 11000, so it does nothing when no index exists. It needs no rollback.
- Archived duplicates are kept in `<collection>_duplicates_archive` and can be restored with their original `_id`.

## 7. Deployment order

1. Deploy the application code that handles duplicate-key errors. This is done in the working tree: `createCourseIntent` returns the existing pending intent when its insert fails with error 11000. Index-free behavior is unchanged.
2. Run scans S1–S6 read-only and share the masked results.
3. The owner reviews and approves the resolution for each group.
4. Rehearse sections 4 and 5 on the disposable database.
5. Create the indexes during low traffic, in the order I1, I3, I6, I2, I5, I4: lowest risk first, and access rows last. Builds on 4.2+ do not block reads or writes for their whole duration, but they still use resources.
6. Verify with `listIndexes`, then watch the logs for duplicate-key errors for a week.
7. Only then describe D2/D3 as closed across processes.

## 8. Alternative for D2: transactions

The grant could instead run inside a multi-document transaction (`session.withTransaction`). That needs a replica set, which Atlas provides, and an end-to-end test on a replica set. That test cannot be run here. The unique indexes are still needed with transactions to stop two different references from both granting. Transactions would make one grant all-or-nothing. Today, the claim-and-retry repair (`settleClaimedIntent` repairs a settled payment row) covers interrupted writes instead.
