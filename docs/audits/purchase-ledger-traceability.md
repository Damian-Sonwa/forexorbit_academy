# ForexOrbit Academy — Super Admin Purchase Ledger and Payment Traceability

Date: 27 October 2026
Status: **implemented in the working tree, uncommitted, awaiting review.** Not deployed. No production database or live Paystack call was used to build or test it.

---

## 1. What was added

A Super Admin page at `/admin/purchases`, linked from the admin panel header and the Super Admin sidebar ("Course Purchases"). It has three tabs.

- **Purchase ledger.** Searchable, filterable, server-paginated list of every course entitlement, plus every successful course payment that has no matching access. A detail panel shows:
  - linked records: access, purchase, payment, checkout, and exceptions;
  - timestamps and verification basis;
  - warnings;
  - an optional read-only Paystack comparison;
  - an investigation-note form;
  - the audit trail.
- **Payment exceptions.** Lists `paymentExceptions` by status (open, investigating, resolved, dismissed, all) with:
  - evidence: reference, reason, amount and currency, provider status, first and last seen, occurrence count;
  - the review, if one has been recorded.
  
  A Super Admin can record a resolution status, an investigation outcome, notes, and a required reason.
- **Audit trail.** Every investigation note, exception review, and Paystack lookup, showing actor, time, action, reason, and before/after values.

Nothing on the page or in its APIs grants, revokes, reassigns, charges, or refunds.

## 2. Files

| File | Purpose |
|---|---|
| `lib/admin-purchase-ledger.js` (+ `.d.ts`) | Classification, joins, warnings, provider comparison, exception review, audit log |
| `lib/admin-ledger-route.ts` | Super Admin check, `Cache-Control: no-store`, rate limits, query parsing |
| `pages/api/admin/purchases/index.ts` | `GET` ledger |
| `pages/api/admin/purchases/[id]/index.ts` | `GET` detail, `POST` investigation note |
| `pages/api/admin/purchases/[id]/verify.ts` | `POST` read-only Paystack lookup |
| `pages/api/admin/payment-exceptions/index.ts` | `GET` exceptions |
| `pages/api/admin/payment-exceptions/[id].ts` | `PUT` record investigation outcome |
| `pages/api/admin/audit-log.ts` | `GET` audit trail |
| `pages/admin/purchases.tsx` | UI |
| `pages/admin/index.tsx`, `components/Sidebar.tsx` | Links (Super Admin only) |
| `tests/admin-purchase-ledger.test.js` | 26 tests |

The Phase 1 payment implementation was not modified.

## 3. Source data (existing collections, read-only)

`userCourseAccess`, `coursePurchases`, `paystackPayments`, `paystackPaymentIntents`, `paymentExceptions`, `users` (name, email, role only), `courses` (title only). Field names were taken from the current code and the git history of every writer.

### Classification

| Source | Rule |
|---|---|
| Verified Paystack purchase | Access row with `paid: true`, linked to a `paystackPayments` row with `status: success` for the **same** student and course. Basis is "server checkout" when a checkout intent exists, otherwise "earlier server verification" (pre-intent routes) |
| Complimentary / manual grant | `entitlementType` is `complimentary` or `manual_grant`. Always shown apart from purchases |
| Historical / backfill | `source` on the access or payment row contains `backfill`. Never counted as verified, even with a payment row, because the backfill script wrote all rows without asking Paystack |
| Requires review: no verified payment | `paid: true` with no linked successful payment for the same student and course |
| No active entitlement | Access row without `paid: true` or a grant |
| Payment without access | Successful course payment whose student has no active access to that course |
| Payment not linked to access | Successful course payment for a student who has access through a different reference (possible second charge) |

### Missing data is not invented

- Amount, currency, payer, and timestamps show "Not recorded" or "Unknown" when absent.
- Manual grants show no amount.

### Payer versus student

- The student is the account holding access.
- The payer email is shown only when it was recorded from Paystack at verification time (`paystackCustomerEmail` written by the pre-Phase 1 verify routes).
- Backfill rows stored the **student's** email in that field, so it is shown as "Not recorded (backfill copied the student's email)", never as a payer.
- Phase 1 stores no payer email, so new purchases show "Not recorded" unless the Super Admin runs the Paystack comparison.

### Warnings

| Warning | Severity |
|---|---|
| Backfill origin | warning |
| Administrative grant | info |
| No provider verification | warning |
| Payment without access | critical |
| Unlinked second payment | warning |
| Payment row naming another student or course | critical |
| Reference disagreement between access and purchase rows | warning |
| Local amount or currency disagreement | warning |
| Payer email differs from student email | warning, labeled "not proof of a problem" |
| Missing student or course | warning |
| Refund or dispute event recorded | warning |
| Unresolved exception | warning |

Paystack comparison warnings, shown only when the Super Admin runs a lookup:

| Warning | Severity |
|---|---|
| Not found | critical |
| Status not success | critical |
| Reference, amount, or currency mismatch | critical |
| Metadata course conflict | critical |
| Metadata course missing | warning |
| Metadata user conflict | critical |
| Metadata user missing | warning |
| Lesson metadata | warning |
| Payer email differs | warning |

Provider metadata is labeled as evidence to compare, not proof of the beneficiary.

## 4. Schema changes

No existing document shape was changed, no index was created, and no migration is needed.

- **New collection `adminAuditLog`** (append-only; created on first insert). Fields: `entityType` (`purchase` | `payment_exception`), `entityId`, `reference`, `action` (`review_note` | `provider_check` | `exception_review`), `reason`, `before`, `after`, `actor { userId, email }`, `createdAt`. Nothing in the code updates or deletes these entries.
- **New optional fields on `paymentExceptions`**, written only by the review action:
  - `review { status, outcome, notes, updatedAt, updatedBy { userId, email } }`;
  - `reviewHistory[]` (each entry: `at`, `actor`, `reason`, `before`, `after`);
  - `reviewVersion`;
  - `resolved`, set to true for resolved or dismissed.
  
  The evidence fields (`reference`, `reason`, `source`, `userId`, `courseId`, `amountKobo`, `currency`, `providerStatus`, `createdAt`, `lastSeenAt`, `occurrences`) are never changed. The review and its history entry are written in **one** document update, guarded by `reviewVersion`, so concurrent reviewers cannot overwrite each other (the second gets HTTP 409).
- **Purchase investigation notes** go to `adminAuditLog` only. Purchase, payment, and access records are not touched.

There was no existing audit mechanism. `adminAuditLog` is additive and does not conflict with any existing collection.

## 5. Security

- **Authorization:** every endpoint is wrapped in `withAuth(handler, ['superadmin'])`, which checks the live role from the database, and the handler repeats the check through `authorizeLedgerAccess`. Admin, instructor, and student accounts get 403. The UI also renders "Access denied" for non-super-admins.
- **Responses:** `Cache-Control: no-store`. No secret, environment variable, or raw provider payload is returned. The Paystack comparison returns status, amount, currency, reference, paid date, channel, domain, metadata IDs, and payer email. Nothing from it is stored except warning codes in the audit log.
- **Paystack lookup:**
  - It uses the existing `GET /transaction/verify/:reference` helper with its 10-second timeout.
  - It is blocked by the same environment guard as payments, so it is unavailable locally with a live key outside production.
  - It is rate limited to 20 lookups per 10 minutes per admin.
- **Writes:** limited to 60 per 10 minutes per admin. A reason of 3 to 500 characters is required, and notes are capped at 2,000 characters. Control characters are stripped, and outcome and status come from fixed lists.
- **Input:** search text is regex-escaped, and unknown filter values are ignored. Record IDs must match `a_<24 hex>` or `p_<24 hex>`. Page size is capped at 50.
- **Output:** all user-controlled text is rendered as React text; there is no `dangerouslySetInnerHTML`.
- **Errors:** handlers return `unexpectedBody` with a request ID and never echo error messages.

## 6. Tests and results

`tests/admin-purchase-ledger.test.js` (26 tests): 24 behavioral tests run the real service against an in-memory collection double and a mocked Paystack lookup. Two are source-contract tests, which check:

- every route requires Super Admin in both places;
- no route or service calls a grant, confirm, intent, webhook, delete, `updateMany`, `createIndex`, initialize, or refund path, or reads the secret key;
- the verify route uses the environment guard.

The behavioral tests cover:

- role rejection;
- classification;
- payer versus student;
- the backfill flag, and the copied email not shown as the payer;
- manual grants;
- payment without access, and an unlinked second payment;
- refund events and local amount disagreements;
- unverified paid flags;
- filtering, search (including regex escaping), and pagination bounds;
- detail with labels for locally written metadata;
- payment-to-access redirect;
- provider comparison, including the exact pattern from the backfill investigation (course conflict, user missing, payer differs);
- provider check audited without storing payer email;
- notes changing nothing else;
- exception listing, review with evidence preserved and history kept, and audit entries;
- concurrent review refused;
- a sweep showing that no operation writes to access, purchase, payment, checkout, user, or course collections.

| Command | Result |
|---|---|
| `node --test tests/admin-purchase-ledger.test.js` | 26 passed, 0 failed (first run) |
| Same, with the backfill rule removed from `classifySource` (mutation) | 21 passed, 5 failed, as expected; code restored |
| `npm test` (network blocked, database and Paystack variables blank) | 257 passed, 0 failed |
| `node --test tests/admin-purchase-ledger.test.js tests/legacy-course-access-report.test.js` (same isolation) | 36 passed, 0 failed |
| `npx tsc --noEmit` | 0 errors |
| `npx next lint` on the new and changed files | 0 errors. Warnings: `require()` in the CommonJS service (same as `course-payment.js`) and existing `any`/`<img>` warnings in `Sidebar.tsx` |

Not run:

- **Browser check of `/admin/purchases`.** The local dev server uses the production database, and signing in as a Super Admin would query live customer data.
- **Real Paystack lookups.**

The new test file is not yet in the `npm test` script (`package.json` was left unchanged).

## 7. Limitations

- **Ledger scan cap.** The ledger reads up to 2,000 access rows and 2,000 successful payments per request (after search and course filters), then applies derived filters and pagination on the server. Beyond that the response sets `truncated` and the UI asks for narrower filters. This suits current volumes (two purchases today). A larger catalogue would need an aggregation pipeline and supporting indexes, under a separate reviewed plan.
- **Lesson payments.** `kind: 'lesson'` payments are not listed, because per-lesson purchases are retired and none exist in the database today.
- **Provider comparisons are not stored**, only their warning codes. Re-run the lookup to see provider values again.
- **Recurring resolved exceptions.** An exception that recurs after it was resolved keeps its resolved status; its `lastSeenAt` and `occurrences` still update and are visible.
- **Stored metadata.** Shown with an explicit label, because the backfill script wrote it locally.
- **Two writes, no transaction.** The audit-log entry for an exception review is a second write after the exception update. If it fails, the review history embedded on the exception still records the change.

## 8. Remaining blockers

Release remains **BLOCKED**.

1. Review of this feature and of the uncommitted Phase 1 payment changes, then a normal commit.
2. A browser check of `/admin/purchases` on a non-production database with seeded test data.
3. Decision on the backfill-sourced purchase. The ledger flags it, and the Paystack comparison will show the course conflict. Any correction needs a separate, reviewed operator process.
4. Refund and dispute access policy.
5. Unique indexes (`paystackPayments.reference`, `userCourseAccess { userId, courseId }`) through a reviewed migration.
6. Hosting settings:
   - remove the old price variables;
   - confirm production mode, the webhook URL, and the production database.
7. Local isolation: a separate database or a read-only user for development. The local `.env` holds a live key and a write-capable production credential.
8. Rate limits are per process.
9. Not yet executed: sandbox payments, real webhook delivery, MongoDB integration tests, browser checkout.
