# ForexOrbit Academy: consolidated pre-release remediation (D1–D10)

- **Branch:** `review/sprint-1-3-integration`. All changes are uncommitted in the working tree.
- **Release status: still BLOCKED.** See the blockers in section 7.
- **How it was verified:** in-memory database doubles, mocked Paystack lookups, and source inspection. The automated tests never contact Paystack or MongoDB. Separately, one manual browser checkout was made in Paystack **test mode** against the isolated development database (section 2a). No production database, live Paystack call, webhook, refund, backfill, migration, index build, deploy or commit was run. Where a result rests only on source text or a mock, it says so.

## 1. Defects fixed

| ID | Finding | What changed |
|---|---|---|
| D1 | Locked lesson content reached students | Fixed earlier in this session for `GET /api/courses/:id/lessons`, `GET /api/lessons` and the course detail builder. **This task:** `GET /api/lessons/:id` (already safe by inspection) now runs on shared, executable rules (`readLessonDetail`), and tests cover the locked 403 body, enrollment, grants, legacy lessons, free/demo lessons and staff. |
| D3 | Concurrent checkout could create two payable intents | Init reuses an unexpired intent Paystack has not seen. After inserting, the later of two simultaneous inserts closes itself and returns the earlier one. A duplicate-key fallback is ready for the planned unique index. A payment on a superseded intent is held for review and never grants. **Within one process only;** see section 2. |
| D2 | Grant is several writes with no transaction | Each confirmation claims its intent with an atomic compare-and-set on `_id`. That serializes callbacks and webhooks for the same reference across processes. A failed write releases the claim; a retry repairs a partial grant without duplicates; a stale claim is taken over after 2 minutes. Cross-reference duplicates still need indexes (section 2). |
| D4 | A second payment for an owned course was accepted silently | Recorded as a `duplicate_payment` exception with provider evidence (existing reference and entitlement type). No second grant, no overwrite, no refund or revoke. Replays are ignored by transaction id. The student sees "You already had full access…". |
| D5 | Paid grant overwrote existing access details | An entitled row (paid, `complimentary`, `manual_grant`) is never modified. A non-entitled row is upgraded and its earlier reference is kept in `previousPaystackReferences` / `previousPaymentReferences`. |
| D6 | Exception review and audit entry not written together | **Recovery mechanism, not a transaction.** The version-guarded review update also reserves the audit entry's id (`pendingAuditIds`) and puts it on the history item. If the audit insert fails, the API returns 500 with `reviewSaved: true`, never a silent success. `repairPendingExceptionAudits` writes the entry under the reserved id (duplicate-safe) the next time the exceptions or audit list loads. The stale-edit 409 is preserved. |
| D7 | A repeat problem didn't reopen a closed exception | A resolved or dismissed exception reopens with `occurrences`, `lastSeenAt`, `reopenCount`, a system history entry and an audit entry (same reserved-id recovery). Duplicate deliveries are deduplicated by event key (max 100 kept). The ledger has labels for `duplicate_payment` and `superseded_intent_paid`. |
| D8 | Ledger totals wrong for large result sets | The server returns `totalIsLowerBound` and `scanCap`. The UI shows a bordered `role="alert"` banner ("Results are incomplete… the total shown is a minimum") and the pager reads "At least N records (incomplete)". |
| D9 | Audit log append-only by convention | Tests now scan `lib`, `pages`, `scripts` and `server.js` and allow only `insertOne`, `find`, `findOne` and `countDocuments` on the audit collection. A behavioral test runs every ledger operation against an audit collection whose update and delete methods throw. **Not database-enforced;** see section 2. |
| Webhook retry | Retryable outcomes were acknowledged | Unfinished processing (for example, a claim held by another request) now returns HTTP 500 so Paystack retries. |

## 2. Findings left unresolved

- **D2/D3 across processes.** Without unique indexes, two server processes can still create two pending intents, or two payment/access rows for different references. A second charge is caught as `duplicate_payment` and does not grant twice, but the extra rows can exist. The fix is the index plan in `docs/audits/course-payment-index-migration-plan.md`. It has **not** been executed.
- **D6 is not atomic.** A pending audit entry stays pending until a super admin opens the Exceptions or Audit tab. The review itself is saved and shows "An audit entry for this exception is still being written."
- **D9 needs a production role change.** MongoDB privileges are additive, so a database-wide `readWrite` on the app user lets it update or delete audit entries. The required owner action is to replace that grant with a custom role that lists the needed collections explicitly and gives only `find` and `insert` on `adminAuditLog`, and to use a separate maintenance user for anything else. Not done here: no credentials or roles were touched.
- **D10, rate limits per process (unchanged, documented).** `lib/rate-limit.js` counts in each process's memory:
  - checkout init: 10 per 10 minutes;
  - confirm: 30 per 10 minutes;
  - ledger provider checks: 20 per 10 minutes;
  - ledger writes: 60 per 10 minutes.

  With N instances, each limit is effectively N times higher, and it resets on restart. The smallest shared-store change that needs no new service is a `rateLimitBuckets` collection keyed `bucket:key:windowStart`, updated with an atomic `findOneAndUpdate` (`$inc`, upsert), plus a TTL index on `expiresAt`. The in-memory limiter would stay as the first layer, and the owner would decide fail-open or fail-closed. **Not implemented.** The TTL index is a new index and needs its own reviewed plan. Distributed rate limiting is **not** solved.
- **Refund and dispute policy.** These events are still recorded for review only and access is unchanged (see Phase G).
- **Backfill purchase `fo_1…gow7`.** Unresolved by design (see Phase G).
- **End-to-end check only partly done.** One path is proven with real Paystack test mode (section 2a). The webhook route is now executed at handler level with locally signed payloads (section 2b), but **no genuine Paystack webhook delivery** has been received. Still covered only by mocks, handler-level tests, or not at all: real webhook delivery, failed and abandoned payments in test mode, a separate second charge, superseded checkouts, the admin ledger UI in a browser, and quiz access after purchase in a browser. Nothing has been run on a replica set.
- **Late conflicting webhook events: resolved on 27 October (approved).** They are now recorded as `late_conflicting_event` exceptions without changing the verified payment, access or purchase (section 2d). *Historical:* before that change they were acknowledged as `already_processed` with no record.

## 2a. Real Paystack test-mode evidence (manual, not automated)

This is the only evidence in this report that involved a real Paystack request. It was a manual browser checkout by the project owner, not part of `npm test`.

- **Environment, checked before reading data:** secret and public keys both had the test prefixes (`sk_test_`, `pk_test_`); `NODE_ENV` unset; database `Forex_elearning_dev`; the connection user `forexorbit_dev` held only `readWrite` on that database (confirmed with `connectionStatus` and `showPrivileges`). Server version 8.0.34. The dev data came from the guarded `scripts/seed-dev.js`.
- **What was proven, after the auto-unlock fix:**
  - The server log shows checkout init (`intent_created`), then `POST /api/courses/<id>/pay` returning 200 with code `granted`, and no full-page `POST /courses/<id>` navigation.
  - The dev database holds that payment (reference ending `…726d`): 1,000,000 kobo (₦10,000) in NGN, source `checkout`, entitlement applied. Paystack's paid time was 20:16:55 and the app recorded it at 20:16:58, with no refresh or second click.
  - On two earlier courses, before the fix, access was granted only by a second Unlock click, through the init-time reconcile with Paystack (`already_owned`). That path is therefore also exercised with real test-mode data.
- **Dev database totals at the time of the check:** 5 checkouts, 5 payments, 5 course-access rows and 5 purchase rows, all for one student. No duplicates, 0 payment exceptions, 0 webhook-sourced payments, and only the default `_id_` index on the payment collections.
- **Not proven by this evidence:** webhook delivery, any failure path, duplicate or replayed deliveries, superseded checkouts, concurrency across processes, or anything about production configuration.

## 2b. Webhook route tests with locally signed payloads (handler level, not Paystack delivery)

`tests/paystack-webhook-handler.test.js` (19 tests when this section was written, all passing; 24 after section 2d) runs the real `pages/api/paystack/webhook.ts`:
- The route is transpiled in memory with the project's `typescript` package.
- The real signature check and the real `lib/course-payment.js` processing are used.
- Only `@/lib/mongodb` is replaced, with an in-memory store, and the payment logger is captured.
- Each run signs payloads with a random, test-prefixed secret generated in the test, never the configured key.
- No network, Paystack, `.env` or MongoDB is used, so **no persistent database write was made**.

| Category | What the tests prove at handler level |
|---|---|
| 1. Valid signed event | 200; one payment (`source: webhook`), one access row, one purchase row; checkout marked paid |
| 2. Invalid signature | Missing, empty, wrong-secret, truncated, uppercase, SHA-256, and body-changed-after-signing all get 401; the database is never opened; a missing secret gets 503 |
| 3. Replay | Four identical deliveries write one set of rows and no exception or audit entries; concurrent duplicates (one process) write one set; a webhook after the browser confirmation is idempotent; a replayed refund event is counted once |
| 4. Wrong amount or currency | Lower, higher or malformed amount, other or missing currency, other course or user in metadata: 200 (recorded for review, so Paystack stops retrying), no grant, checkout stays pending, replay not counted twice; an unknown reference goes to review |
| 5. Unsupported or malformed | Unknown events and malformed shapes are ignored with no writes; signed invalid JSON 400; GET 405; body over 256 KB 400; failed or abandoned charges grant nothing |
| 6. Processing failure | Database outage, a write failure part-way, and a failing review record all return 500 (Paystack retries) with nothing marked complete; the part-way failure is released and the redelivery completes once; a claim held by another request gives 500 and is left alone |
| 7. Delayed or repeated events | After a verified payment, late events with a bad amount, currency, status or metadata change no row; refunds and disputes leave access unchanged; a charge on a superseded checkout is held; a charge on a complimentary grant is recorded as a duplicate and the grant is kept |

**Mutation checks.** Ten deliberate breakages were applied to a throwaway copy in `%TEMP%`, never to the working tree. Each one made at least one of these tests fail:
- signature check bypassed;
- amount check removed;
- currency check removed;
- paid early return removed;
- retryable outcome acknowledged;
- route ignoring `ack: false`;
- route returning 200 on error;
- claim not released on failure;
- refund and dispute events not recorded;
- superseded hold removed.

The copy was deleted afterwards.

**What these tests do not prove:**
- Paystack's real headers, encoding, payload shape (for example `metadata.custom_fields`), retry schedule, or the webhook URL configured in the dashboard;
- the route running inside the real Next.js server (the route itself, `server.js` and `middleware.ts` were inspected: the raw body reaches the route unparsed and no feature flag blocks `/api/paystack/*`);
- behavior against real MongoDB, or across processes.

## 2c. Webhook security and observability review (27 October 2026)

Code reviewed: `pages/api/paystack/webhook.ts`, `lib/course-payment.js` (`decidePaymentEnvironment`, `verifyWebhookSignature`, `processWebhookEvent`, `confirmCoursePayment`, `evaluateTransaction`, `recordPaymentException`), `server.js` request handling, `middleware.ts`, and the payment and ledger tests.

**Confirmed vulnerabilities: none found.**
- The signature is an HMAC-SHA512 of the raw body with `PAYSTACK_SECRET_KEY`, compared in constant time, and checked before JSON parsing or any database access.
- No environment bypass exists.
- A missing secret, a live key outside production, or a shared database return 503 before the body is read.
- Unfinished processing returns 500 so Paystack retries; recorded or ignored events return 200.

**Design decisions raised by this review.** The owner approved both and they were implemented on 27 October; see section 2d. The original proposals are kept below as written:
1. **Evidence for late conflicting events.** Proposal: when a signed `charge.success` arrives for an already-paid reference and its amount, currency, status or metadata differ from the stored payment, record a `late_conflicting_event` exception, deduplicated by event key. The exception would hold codes and amounts only, no customer data, and payment and access would not change. This adds a new exception type and ledger label, so it changes exception and audit semantics.
2. **A test key in production.** With `NODE_ENV=production`, `decidePaymentEnvironment` enables payments for `sk_test_` keys as well as live keys (mode `test`). If production were misconfigured with test keys, Paystack test cards would unlock real courses. Options:
   - refuse test keys in production unless an explicit staging flag is set;
   - or keep the current behavior and add a deployment check.

   This changes payment-environment behavior.

**Optional hardening (not required for correctness):**
- **Oversized bodies.** The route returns 400 and destroys the request; on a real socket the response may never be sent. A 413 without destroying the request would be cleaner. Paystack payloads are far below 256 KB.
- **Replay window.** Paystack signs the body only; there is no signed timestamp header. A timestamp window is therefore not possible, and an age check on `paid_at` would wrongly reject legitimate late retries. Replay safety rests on reference-level idempotency, which the tests confirm. Exceptions are deduplicated by `txn:<data.id>` and refund or dispute exceptions by `event:<event>:<data.id>`.
- **Rate limiting.** Not recommended for valid signed requests: Paystack retries failed deliveries, and a per-process limiter could drop legitimate retries while adding no protection that the signature check doesn't already give. If log noise from unsigned requests becomes a problem, limit only requests that fail the signature check.
- **Source IP allowlist.** Paystack publishes its webhook source IPs. An allowlist would need care behind Render's proxy (`X-Forwarded-For`), and the signature already authenticates the sender.

### Webhook operations and configuration failures

| Situation | Route response | Effect |
|---|---|---|
| `PAYSTACK_SECRET_KEY` missing | 503 `not_configured` | Paystack retries; nothing processed |
| Live key with `NODE_ENV` not `production` | 503 `live_key_outside_production` | Same |
| Test key, non-local URI, database `Forex_elearning` | 503 `shared_database` | Same |
| Secret rotated in Paystack but the server still has the old key, or the server key belongs to a different Paystack account or mode | 401 `invalid_signature` on every delivery | Webhooks stop granting. Browser confirmation also fails if the old key no longer authenticates with the Paystack API (it then returns a retryable `provider_uncertain`) |
| Database unavailable | 500 `processing_failed` | Paystack retries |

**Secret rotation procedure** (owner action; nothing was rotated here). Paystack uses the secret key both to call its API and to sign webhooks, so the two can't be rotated separately.
1. Generate the new key in the Paystack dashboard for the correct mode (test or live).
2. Update `PAYSTACK_SECRET_KEY` on the server and restart.
3. Watch the payment logs for `invalid_signature` codes.
4. Deliveries signed with the old key during the switch fail with 401 and are retried by Paystack.
5. Reconcile any payment made during the window: the next checkout start reconciles it, or support can use "Paid but still locked?".

Keep test and live keys in separate environments.

## 2d. Approved payment safeguards implemented (27 October 2026)

Both reuse existing mechanisms. There is no new processing path.

**1. Late conflicting webhook events** (`lib/course-payment.js`):
- `processWebhookEvent` calls a new `recordLateConflict` only when `confirmCoursePayment` returns `ok` with `alreadyProcessed` (a verified payment already exists for the reference).
- It compares the signed event's amount, currency (case-insensitive) and status with the stored successful payment. Metadata is not compared; it is checked once, at verification.
- On a conflict it calls the existing `recordPaymentException` with reason `late_conflicting_event` and source `webhook`. It stores the user and course ids from the stored payment, the event's amount, currency and status, and evidence `{ conflicts, recordedAmountKobo, recordedCurrency, recordedStatus }`. It stores no customer data.
- The event key is `late:<data.id>:<amount>:<currency>:<status>`:
  - an identical redelivery is a replay and is not counted;
  - a different conflict counts as a new occurrence;
  - a resolved exception reopens through the existing path, with history and an audit entry.
- The webhook responds 200 with code `late_conflicting_event`. Payment, access, purchase and checkout rows are not written. If the exception can't be stored, the route returns 500 and Paystack retries.
- A ledger label was added in `lib/admin-purchase-ledger.js`: "Later webhook event conflicts with the verified payment".

**2. Test keys refused in production** (`lib/course-payment.js`, `decidePaymentEnvironment`):
- With `NODE_ENV=production`, only an `sk_live_` key enables payments.
- An `sk_test_` key returns `enabled: false`, status 503, reason `test_key_in_production`. Any other non-empty value returns `unrecognized_key`.
- The message is "Payments are disabled: production requires a live Paystack secret key" and never echoes the key.
- Every payment route already takes its decision from this function:
  - checkout init and confirmation, through `paymentsAllowed` and `respondWithCourseConfirmation`;
  - the webhook (503 before reading the body);
  - the Super Admin provider check (503).
- Development and test behavior is unchanged: test key plus isolated database is enabled; live key outside production is refused; shared database is refused.
- `isPaystackConfigured` (lesson display) is unchanged, so paid lessons stay locked and checkout reports the configuration error.

**New tests** (all passing, outbound network blocked):
- `tests/paystack-webhook-handler.test.js` (24 tests, up from 19):
  - 7 was updated to the approved behavior: the verified rows are unchanged and one exception holds three conflicting occurrences;
  - 7e: stored fields only, no customer data, identical redeliveries counted once;
  - 7f: a matching redelivery (including lowercase currency) records nothing, and a resolved conflict reopens instead of duplicating;
  - 7g: a conflict on a manual-grant duplicate leaves the grant untouched;
  - 7h: a storage failure returns 500;
  - 8: in production a test key returns 503 before the body or database is touched, and the same key works outside production.
- `tests/course-purchase.test.js` (57 tests, up from 55):
  - every production and development key combination, with the key never echoed;
  - a source contract that every payment route uses `decidePaymentEnvironment`.

**Mutation checks** (throwaway copy in `%TEMP%`, deleted afterwards). Each of these broke at least one new test:
- not recording the conflict (5 failures);
- accepting test keys in production again (1);
- ignoring a currency conflict (3);
- dropping the value-specific event key (2).

## 3. Files changed (this task)

| File | Change |
|---|---|
| `lib/course-payment.js` | Claim/release, duplicate and superseded holds, entitlement preservation, recurring exceptions with reserved-id audits, init reuse/self-yield/duplicate-key fallback, webhook ack, exports |
| `lib/course-payment.d.ts` | Types for new exports and result fields |
| `lib/admin-purchase-ledger.js` | Reserved audit id on review, 500 on audit failure, `repairPendingExceptionAudits`, labels, `auditPending`, `totalIsLowerBound`/`scanCap`; uses `AUDIT_COLLECTION` from course-payment |
| `lib/admin-purchase-ledger.d.ts` | Types |
| `lib/course-lesson-list.js` | `readLessonDetail`, `LESSON_LOCKED_MESSAGE`; `isDemo` flag aligned with `computeMonetizationFlags` |
| `lib/course-lesson-list.d.ts` | Types |
| `pages/api/lessons/[id].ts` | GET delegates to `readLessonDetail`; PUT and DELETE unchanged |
| `pages/api/admin/payment-exceptions/[id].ts` | Passes `reviewSaved` on the 500 |
| `pages/api/paystack/webhook.ts` | Returns 500 when `outcome.ack` is false |
| `pages/admin/purchases.tsx` | Truncation banner, "At least N" pager, saved-but-unaudited message, audit-pending note, system actor label |
| `tests/course-purchase.test.js` | Upgraded memory store (operators, racy mode), 16 new tests, webhook source assertion |
| `tests/admin-purchase-ledger.test.js` | Test double gains duplicate-`_id`, `$pull` and `$inc`; updated write counts; 9 new tests (D6–D9) |
| `tests/course-lesson-list.test.js` | Seed refactor, 10 single-lesson tests |
| `tests/lesson-read.test.js`, `tests/quiz-access.test.js` | Source contracts follow the moved logic (route plus `lib/course-lesson-list.js`) |
| `package.json` | `npm test` now includes `admin-purchase-ledger` and `legacy-course-access-report` tests |
| `docs/audits/course-payment-index-migration-plan.md` | New (plan only) |
| `docs/audits/consolidated-pre-release-remediation.md` | New (this report) |

The D1 files from earlier in this session (`lib/course-lesson-list.*`, `pages/api/courses/[id]/lessons.ts`, `pages/api/lessons/index.ts`, `lib/course-lessons-locked.ts`) were left as they were, apart from the additions listed above.

### 3a. Files changed after the first version of this report

All uncommitted. None of these changes the server-side payment rules in `lib/course-payment.js`: access is still granted only after the server verifies the payment with Paystack.

| File | Change |
|---|---|
| `lib/course-checkout.js`, `lib/course-checkout.d.ts` | New browser-side helper. It keeps the pending reference per course (24-hour expiry), resumes it after a reload or a `reference`/`trxref` return, confirms with retries (2 s, 5 s, 10 s) and deduplicates confirms per reference. It clears the stored reference only when it matches the one confirmed, ignores stale Paystack form fields, and blocks the Paystack host form's own submission. |
| `components/monetization/PaystackCourseUnlock.tsx` | Uses the helper: automatic confirm after payment, resume on load, a "Check payment status" button when a retry is possible, and silent handling of stale references from another course |
| `lib/paystack-inline-script.ts` | Neutralizes the Paystack host form (no POST navigation), reports its submit attempts to a listener, and resets stale reference fields before each checkout |
| `pages/courses/[id].tsx` | The "Paid but still locked?" field trims trailing punctuation from a pasted reference |
| `pages/index.tsx` | Hero image priority written as a lowercase `fetchpriority` attribute to remove a React warning |
| `scripts/seed-dev.js` | New guarded seed for the isolated dev database only. It refuses unless the database is `Forex_elearning_dev`, the user is `forexorbit_dev`, the connection's roles are limited to that database, and every seed collection is empty. It never deletes data and never imports the production seed scripts. The demo password is read from the terminal and never printed. |
| `scripts/reset-dev-demo-passwords.js` | New. Resets only the `@demo.com` demo accounts' passwords in the dev database, behind the same guards plus an update-privilege check |
| `tests/course-checkout-unlock.test.js` | New, 9 tests: real `confirmCoursePayment` against an in-memory database with a **mocked** Paystack lookup, plus a source contract |
| `tests/seed-dev.test.js`, `tests/reset-dev-demo-passwords.test.js` | New, 13 and 3 tests, using a fake MongoDB client. No database connection. |
| `tests/performance-hot-paths.test.js` | The hero-image assertion accepts the lowercase `fetchpriority: 'high'` form. It still requires high priority. |
| `package.json` | `npm test` now also runs `course-checkout-unlock`, `seed-dev` and `reset-dev-demo-passwords` (40 test files), and later `paystack-webhook-handler` (41 files) |
| `tests/paystack-webhook-handler.test.js` | New, 19 tests: the real webhook route with locally signed payloads and an in-memory database (section 2b) |
| `docs/audits/paystack-test-webhook-delivery-plan.md` | New. Plan only, for a genuine Paystack test-mode webhook delivery; prerequisites validated read-only; nothing else executed |
| `docs/audits/browser-verification-checklist.md` | New. Manual browser checks with read/write classification; not executed |
| `lib/course-payment.js` (27 October, approved) | `late_conflicting_event` recording (`lateEventConflicts`, `recordLateConflict`); production refuses non-live keys (section 2d) |
| `lib/admin-purchase-ledger.js` (27 October) | Label for `late_conflicting_event` |
| `tests/course-purchase.test.js` (27 October) | 2 new tests: production key combinations; every payment route uses `decidePaymentEnvironment` |
| `scripts/webhook-only-forwarder.js` (27 October, new) | Loopback forwarder for the genuine-delivery plan. The tunnel points at it, and only `POST /api/paystack/webhook` reaches the dev server. Not payment code, and never run against the dev server |
| `tests/webhook-only-forwarder.test.js` (27 October, new) | 3 tests: other methods and paths get 404 and never reach the target; the body is forwarded byte for byte with only `content-type` and the signature header; 413 above 256 KB; 502 when the target is down |
| `package.json` (27 October) | `npm test` also runs `webhook-only-forwarder` (42 files) |
| `docs/audits/browser-verification-checklist.md`, `paystack-test-webhook-delivery-plan.md` (27 October, later run) | Signed-out read-only browser results; forwarder steps; test candidates; re-check |
| `scripts/webhook-only-forwarder.js` (28 October, hardened) | Refuses a non-loopback target (constructor and CLI exit 1); always binds `127.0.0.1`; strips the query string and always forwards to the fixed webhook path; forwards only `content-length`, `content-type` and `x-paystack-signature`; relays only the status, `content-type` and body (no `set-cookie`); 413 on a declared or streamed body over 256 KB; 504 on an upstream timeout (15 s), 502 on an upstream error; request and header timeouts; 400 on malformed requests. Still never run against the dev server |
| `tests/webhook-only-forwarder.test.js` (28 October) | Now 9 tests, all against mock HTTP servers on loopback: routing; header allow-list (the forwarded header set is exactly `connection`, `content-length`, `content-type`, `host`, `x-paystack-signature`); query-string credentials dropped; response headers filtered; declared oversize; upstream timeout; client abort and malformed requests; loopback bind and target refusal; the CLI as a child process |
| `tests/course-checkout-unlock.test.js` (28 October) | Now 12 tests. New: reloads after success make no further Paystack lookup; abandoned, not-found and uncertain results and 429 retries leave no payment rows and the intent `pending`; two tabs confirming the same reference produce one payment, one access row and one purchase row |
| `docs/audits/browser-verification-checklist.md` (28 October) | Signed-in read-only checklist S1–S8 for the owner to run personally |
| `docs/audits/paystack-test-webhook-delivery-plan.md` (28 October) | Section C split into C1–C6 (forwarder tests, local start, local check, install, tunnel to `127.0.0.1:3901` only, public probes proving app pages give 404); all-collection hash snapshot before and after; cleanup checks that no tunnel process remains |

The two seed/reset scripts were run only by the project owner, against the dev database, after their guards passed. They are not run by any test.

## 4. Functions: before and after

| Function | Before | After |
|---|---|---|
| `confirmCoursePayment` | Read the intent, then wrote payment, access, purchase and intent rows directly | Loop: paid → already processed; held → held result; otherwise claim. Busy → 409 `payment_processing` (retryable); closed → 409. A throw releases the claim. |
| `settleClaimedIntent` (new) | — | Repairs a settled payment (re-grant or re-hold), looks up the provider, validates, holds `duplicate_payment` / `superseded_intent_paid`, otherwise grants |
| `grantCourseEntitlement` | Upserted access/purchase with `$set`, overwriting type and reference | Inserts if missing; upgrades a non-entitled row and keeps previous references; never touches an entitled row |
| `holdPayment` / `heldResult` (new) | — | Stores the payment with `entitlementApplied: false` and its evidence, records the exception, sets the intent to `held`. Duplicate → ok with `duplicatePayment`; superseded → 409 `needs_review` |
| `recordPaymentException` | Upsert: `$inc occurrences` only | Returns `created`, `replay`, `occurrence` or `reopened`; event-key dedupe; reopens closed exceptions with history and an audit entry |
| `createCourseIntent` | Superseded every open intent not found at Paystack | Reuses an unexpired unseen intent; supersedes only failed/abandoned/expired; self-yield after insert; duplicate-key fallback |
| `processWebhookEvent` | Always acknowledged | Retryable → `ack: false`; duplicate → `ack: true, code: 'duplicate_payment'`; event keys on review-only events |
| `updateException` | Guarded update, then separate audit insert (failure surfaced as an unexpected 500) | Guarded update reserves the audit id; audit failure → 500 with `reviewSaved: true`, repaired later |
| `listExceptions`, `listAudit` | Read only | Run `repairPendingExceptionAudits` first (writes only when something is pending) |
| `listPurchases` | `truncated` | Adds `totalIsLowerBound` and `scanCap` |
| `getLesson` (route) | Inline TS rules with `getMonetizationForLessonDoc` | Calls `readLessonDetail`. Same gates, order, 403 body and response fields. |
| `priceCourseLessons` | `isDemo` true on a free first lesson; false for staff | Matches `computeMonetizationFlags`: false on the free first slot, the real value for staff (display flag only; lock state unchanged) |

## 5. Tests and commands (real results)

| Command | Result |
|---|---|
| **Current baseline (28 October 2026, after forwarder hardening and the checkout tests):** `npm test` (42 files), network blocked by the temporary preload (a probe confirmed `fetch` and a socket by IP were refused), sensitive variables removed, no `.env` loaded | **412 tests, 412 pass, 0 fail, 0 skipped, 0 cancelled** (exit 0): the 403 below plus 6 forwarder and 3 checkout tests. `npx tsc --noEmit -p tsconfig.json` exit 0. `npm run lint` exit 0, 0 errors, 587 warnings (unchanged). ESLint on the changed forwarder, test and logo files: 0 errors, 14 repo-wide `no-require-imports` warnings |
| **`npm run build` (28 October run)** in a temporary copy (0 `.env` files in the copy, junctioned `node_modules`, network blocked, dummy loopback `MONGO_URI`, throwaway `JWT_SECRET`) | **Exit 0** in 150 s. The copy was deleted after its junction was removed; the real `node_modules` and the dev server's `.next` were untouched |
| **Forwarder mutation checks (28 October)** | In a temporary copy: allowing any target host, forwarding the original URL with its query string, forwarding all request headers, relaying all response headers, removing the declared-length check and removing the upstream timeout each made forwarder tests fail. Removing the client-error handler did **not** make any test fail: the handler is defensive and Node already closes malformed connections. The copies were deleted |
| **Previous baseline (27 October 2026, later run, after adding the forwarder test):** `npm test` (42 files), same isolation as below | **403 tests, 403 pass, 0 fail, 0 skipped, 0 cancelled** (exit 0). `npx tsc --noEmit -p tsconfig.json` exit 0. `npm run lint` exit 0, 0 errors, 587 warnings (unchanged; the lint script doesn't cover `scripts/` or `tests/`, and ESLint on the two new files gives 0 errors and 5 of the repo-wide `no-require-imports` warnings). Before the forwarder was added, the same run gave 400/400. |
| **`npm run build` (same run)** in a temporary copy (no `.env`, junctioned `node_modules`, network blocked, dummy loopback `MONGO_URI` and throwaway `JWT_SECRET`) | **Exit 0** in 164 s. Compiled successfully, 43/43 static pages, 587 lint warnings printed during the build, no errors. The copy was deleted after its junction was removed; the dev server's `.next` was untouched |
| Earlier baseline (27 October 2026, after the section 2d safeguards): `npm test` (41 files), same isolation as below | **400 tests, 400 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo** (exit 0). Targeted: webhook handler 24/24, course purchase 57/57, admin ledger 35/35, checkout unlock 9/9. `npx tsc --noEmit -p tsconfig.json` exit 0. `npm run lint` exit 0, 0 errors, 587 warnings (unchanged). |
| Previous baseline (27 October 2026): `npm test` (41 files) with `NODE_OPTIONS=--require=<temp preload>`, which blocks `fetch`, DNS lookups and every non-loopback socket (a probe before the run confirmed `fetch` and a socket by IP were refused), and with `MONGO_URI`, `MONGODB_URI`, `MONGODB_DB_NAME`, `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, `JWT_SECRET` and `DEMO_SEED_PASSWORD` removed from the process environment. The preload was created in `%TEMP%` and deleted afterwards. | **393 tests, 393 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo** (exit 0) |
| `node --test tests/paystack-webhook-handler.test.js` (same isolation) | 19 / 19 |
| `npm run build`, run in a temporary copy of the working tree in `%TEMP%` (the dev server was using the project's `.next`). The copy excluded `.env*`, `.next` and `.git` and linked `node_modules`. Run with the same network-blocking preload, `NEXT_TELEMETRY_DISABLED=1`, and dummy values only: a loopback `MONGO_URI` to a closed port, a dummy database name, a random `JWT_SECRET`, and no Paystack keys. | **exit 0**. Next.js 15.5.28, compiled in 87 s, 43 of 43 static pages generated, 203 s total. The log has 587 `Warning:` lines (lint) and no build errors. The webhook route was emitted. The output had no MongoDB URI with credentials, no `sk_` key, and no dummy secret in client chunks. The copy was deleted afterwards. |
| `npm run lint` (latest, same isolation) | exit 0, 0 errors, 587 warnings |
| `npm audit --json` | **Not run.** It must send the dependency tree to the npm registry, which the network restriction blocks. The last recorded result (26 October, `release-readiness-2026-10-26.md`) was 3 moderate, 0 high, 0 critical. Installed versions were re-read offline from `package-lock.json` (see that document's status update). |
| Earlier baseline (40 files) | 374 tests, 374 pass, 0 fail |
| `node --test tests/course-checkout-unlock.test.js` | 9 / 9 |
| `node --test tests/seed-dev.test.js` | 13 / 13 |
| `node --test tests/reset-dev-demo-passwords.test.js` | 3 / 3 |
| Earlier run (first version of this report, 37 files) | 349 tests, 349 pass, 0 fail |
| `node --test tests/course-purchase.test.js` | 55 / 55 |
| `node --test tests/course-lesson-list.test.js` | 31 / 31 |
| `node --test tests/admin-purchase-ledger.test.js` | 35 / 35 |
| `node --test tests/legacy-course-access-report.test.js` | 10 / 10 |
| `npx tsc --noEmit -p tsconfig.json` | exit 0, 0 errors (latest run) |
| `npm run lint` (earlier run) | exit 0, 0 errors, 589 warnings. Two were `no-explicit-any` in the new `lib/course-checkout.d.ts`; they were changed to `unknown`, after which `npx eslint lib/course-checkout.d.ts` reports none and `tsc` still exits 0. The full lint was not re-run after that change. (First report: 587 warnings.) |

**Two failures found and fixed while establishing the current baseline.** The first 40-file run gave 374 tests, 372 pass, 2 fail. Both were caused by changes made in this session, not by the test infrastructure:
- `performance-hot-paths`: the assertion looked for the old `fetchPriority="high"` spelling after the hero image was changed to the lowercase attribute. The assertion now accepts either spelling and still requires high priority.
- `security-remediation` ("source does not embed a MongoDB SRV connection string"): the new seed tests used fake `mongodb+srv://…@dev.example.invalid` URIs, and one seed-dev error message contained the scheme text. The fake URIs now use `mongodb://` (the guards treat both schemes the same) and the message names the schemes without `://`. The scanner was not changed.

That first run also showed the temporary network preload let a raw socket through. It was fixed, re-probed, and the 374-pass result above comes from the fixed preload.

**Mutation checks.** I disabled each fix in a temporary copy, ran the targeted tests, then deleted the copy. Every mutation made the targeted tests fail:
- removing the claim;
- removing duplicate detection;
- removing reopening;
- removing the superseded hold;
- removing the init reconcile;
- reporting an audit failure as success;
- disabling the repair;
- forcing `totalIsLowerBound` false;
- removing the single-lesson paywall;
- removing the single-lesson read rule.

**The 14 required behaviors:**

| # | Behavior | Test (file) |
|---|---|---|
| 1 | Buying grants all lessons | "a verified ₦10,000 payment grants the full-course entitlement once" (purchase); "a verified full-course entitlement unlocks every lesson…" and "single lesson: paid, complimentary, and manual entitlements…" (lesson-list) |
| 2 | Wrong amount or currency rejected | "a lower paid amount is rejected…", "a payment in another currency is rejected…", "a webhook with a tampered amount…" |
| 3 | Replays don't duplicate | "repeated callbacks and webhook deliveries do not duplicate…", "replaying the reference that granted access is not treated as a duplicate payment" |
| 4 | Separate second charge → exception | "a genuinely separate second charge for an owned course is kept, recorded once, and changes no access" |
| 5 | Grants keep their type | "a payment for a course held through a complimentary or manual grant keeps the grant…", "an earlier non-entitled access row is upgraded and its old reference is kept" |
| 6 | Superseded intent doesn't grant | "a payment on a superseded checkout is kept for review and does not grant access" |
| 7 | Invalid signatures rejected | "webhook signatures must match the raw body and the server secret" (+ source contract: no bypass) |
| 8 | Recurring exceptions reopen | "a resolved or dismissed exception reopens when it recurs…", "an open exception only counts a new occurrence…" (purchase); "duplicate and superseded payment exceptions have labels and reopened exceptions show as open" (ledger) |
| 9 | Both list endpoints and the single-lesson endpoint protect content | "GET /api/lessons and GET /api/courses/:id/lessons return the same lesson views…", the "single lesson: …" tests, "single lesson and lesson lists agree on paywall state…" |
| 10 | Non-superadmins blocked from the ledger | "only a super admin may use the ledger" (behavioral, on `authorizeLedgerAccess`) + source contract on every route |
| 11 | Concurrent edits give 409 | "an unchanged review is rejected and a stale concurrent review is refused", "a stale concurrent review still gets 409 and writes no audit entry" |
| 12 | Audit consistent with reviews | "recording an exception outcome preserves evidence…" (history `auditId` equals the audit `_id`), "if the audit entry cannot be written…", "a repair that races the original audit insert…" |
| 13 | Truncation indicated | "a ledger scan that hits the cap marks its total as a lower bound" + UI source contract |
| 14 | Lesson requests don't mutate | "requesting lesson lists never creates or changes…", "single lesson requests never create or change…" |

## 6. Test limitations

- **Source-contract-only tests.** These read source files; they don't execute them.
  - `course-purchase`, 4 tests: retired lesson route 410; no webhook signature bypass (now also checks the 500 on `!ack`); price not read from env; checkout pages use the server intent.
  - `course-lesson-list`, 4 tests: auth before lesson read; both list endpoints use shared presentation; the single-lesson route delegates to `readLessonDetail`; module is read-only.
  - `admin-purchase-ledger`, 5 tests: super admin in wrapper and handler; no grant/charge/refund calls; exception route returns the pending-audit failure; truncation UI; no audit update/delete anywhere.
  - `legacy-course-access-report`, 1 test: no write-capable calls.
  - `lesson-read`, `quiz-access`: the route-delegation assertions.
- **Routes are mostly not executed.** Next.js API routes and `withAuth` are TypeScript and run only by source contract; the logic they call is executed. The exception is the Paystack webhook route, which `tests/paystack-webhook-handler.test.js` executes with an in-memory database (section 2b).
- **Concurrency is simulated in one process** by a store that yields between read and insert. That does not prove cross-process behavior (section 2).
- **The D9 scan** matches `collection(AUDIT_COLLECTION | 'adminAuditLog').<method>`. A dynamically built collection name would evade it.
- **The admin UI was not opened in a browser.** Banner, pager and messages are checked by source contract only.
- **The Paystack provider is mocked in every automated test,** including the new checkout/unlock tests. The only real Paystack activity is the manual test-mode browser checkout in section 2a, which covers the success path only.
- **Seed and reset tests use a fake MongoDB client.** They check the guards and write stages; they don't prove behavior against a real server.

## 7. Blockers (release stays BLOCKED)

1. **Unique indexes (D2/D3), partly done (28 October).**
   - **Dev database:** built and verified with `scripts/course-payment-indexes.js`.
   - **Production:** still needed. The order is to deploy the duplicate-key handling, run the dry-run scans, build, then watch for a week. See `production-database-runbook-indexes-and-role.md`.
   - **Not done:** the disposable rehearsal and a cross-process test, because no local `mongod` is available.
2. **Backfill `fo_1…gow7`:** ownership decision (Phase G).
3. **Refund and dispute policy:** undecided (Phase G).
4. **End-to-end verification (partly done):**
   - **Done:** the test-mode success path (checkout, callback, server verification, automatic unlock, init-time reconcile) is proven on the isolated dev database (section 2a). The webhook route's behavior is proven at handler level with locally signed payloads (section 2b).
   - **Still needed:**
     - a **genuine Paystack test-mode webhook delivery** (plan: `docs/audits/paystack-test-webhook-delivery-plan.md`, not executed; the tunnel now goes through the webhook-only forwarder);
     - failed and abandoned payments in test mode;
     - a separate second charge;
     - a superseded checkout;
     - the **signed-in** browser checks of the lesson, quiz and ledger pages (signed-out read-only checks passed on 27 October);
     - mobile testing.
5. **D9 role change, prepared but not applied.**
   - **Ready:** the custom role (`lib/app-database-role.js`) and a read-only checker (`scripts/check-db-role.js`).
   - **Dev check:** on the dev user the checker reports FAIL, as expected, because `readWrite` allows update and remove on `adminAuditLog`.
   - **Still needed:** the owner creates the role in Atlas and switches the app user (runbook).
6. **D10 (28 October): shared store implemented, not deployed.** Payment and ledger routes now also count in MongoDB `rateLimits` and fail closed with 503. The shared count is off until `SHARED_RATE_LIMIT=mongodb` is set, which happens after R1 is built in production. A real-MongoDB rehearsal across 8 processes passed. See the current status in `release-readiness-2026-10-26.md`, the authoritative report.
7. ~~Owner decisions from the webhook review (section 2c)~~: **both approved and implemented** (section 2d).
8. **Dependencies:** 3 moderate `npm audit` findings with no risk acceptance; the audit was not re-run in this session (network restricted).
9. **Cross-process safety is not verified.** It must not be claimed until tested against real MongoDB with the unique indexes in place.

## Phase G: decisions the owner must make (no policy chosen here)

**Backfill purchase `fo_1…gow7`.** It is a real live ₦5,000 payment, recorded by the old backfill script. Its provider metadata names a different course, it has no user, and the payer differs from the student holding access. Nothing in this change alters, reassigns, refunds or revokes it. The ledger keeps showing its warning. The owner needs to decide who the purchase belongs to and which course it was for, based on evidence outside this codebase (Paystack dashboard, support contact with the payer). This report adds no evidence and makes no inference about either.

**Refund and dispute policy.** Refund and dispute webhooks are recorded as `refund_unhandled` / `dispute_unhandled` exceptions and change no access. Repeat deliveries now count occurrences and reopen closed exceptions. Questions for the owner:
- Should a full refund remove course access, and does that apply to a partial refund?
- Should an open dispute suspend access, and should a lost dispute remove it?
- Who approves each case?
- How are `duplicate_payment` and `superseded_intent_paid` exceptions settled: refund, credit, or keep?

Until those are answered, the code leaves access unchanged.

## Phase H: workspace and safety checks

- **Baseline comparison.** `git status --porcelain=v1 --untracked-files=all` was compared with the baseline captured before this work (92 entries). Every baseline entry is still present: four untracked folders now list file by file, and no tracked file reverted. The only new entries are `pages/api/lessons/[id].ts`, `tests/lesson-read.test.js` and `tests/quiz-access.test.js`, all modified for Phase A. The two new docs are inside an existing untracked folder. HEAD is unchanged, and there are no stash entries, commits or resets.
- **Secret scan.** All 16 changed source/test files were scanned for Paystack key prefixes, MongoDB URIs with credentials, JWTs, private keys and personal email domains: 0 hits. The only email domains present are test placeholders (`*.test`, `example.com`).
- **No `.env` or production database access.** `.env` was not opened, listed or printed. No test command loads it: the only `dotenv` call reachable from the tests sits inside `scripts/legacy-course-access-report.js` `main()`, which runs only when that script is executed directly. No command connected to MongoDB, and every test run blocked non-loopback network.
- **Nothing executed against shared systems.** No migration, index, backfill, deploy, commit, push, stash or credential change.
- **Later work (sections 2a and 3a) and the dev database.** The statements above describe the first version of this report. Afterwards:
  - the project owner ran the guarded seed and password-reset scripts against the dev database;
  - the owner made the test-mode checkout in section 2a;
  - read-only queries checked the dev database, each after confirming the connection was limited to `Forex_elearning_dev`.

  The production database was never connected to. The latest test run loaded no `.env` values: the relevant variables were set to empty and the network was blocked.
- **Webhook work (sections 2b and 2c).**
  - The only database contact was one `connectionStatus` command on the dev cluster to reconfirm isolation; no data was read or written.
  - The webhook tests, mutation checks, build and lint ran with outbound network blocked.
  - Paystack was not contacted, no tunnel was opened, and the Paystack dashboard was not changed.
  - The temporary build copy and the mutation copy were deleted after their `node_modules` links were removed. All 511 non-optional packages in the lockfile are still present in `node_modules`.
- **Safeguard work (section 2d) and the delivery-plan checks.**
  - All tests ran offline against in-memory stores.
  - Two read-only dev-database sessions ran, each after verifying isolation: payment counts and fixture counts, with no ids or emails printed.
  - One unsigned local `POST` went to the running dev server's webhook route; it returned 401 before the database was opened.
  - No tunnel, dashboard change, checkout, seed, index or migration.
- **Verification run (27 October, later).**
  - Database reads (all read-only, isolation verified each time):
    - before and after snapshots of all 14 collections (counts and content hashes only): no change;
    - one fixture query that printed masked ids.
  - Browser checks were signed out and GET only; the dev log shows no non-GET request.
  - A loopback run of the forwarder against the dev server was blocked by auto-review as too close to exposure. It was not retried and is step C3 of the plan (renumbered on 28 October).
  - Build, tests and lint ran with outbound network blocked.
  - No tunnel, dashboard change, checkout, Paystack call, seed, index, migration, dependency change or deploy.
- **Forwarder and checkout review (28 October).**
  - The forwarder was tested only against mock servers on loopback; it was never started against the dev server, and nothing listened on port 3901 afterwards.
  - One read-only dev-database session ran after isolation was verified: counts only, unchanged (intents, payments, access and purchases 5 each; no exceptions or audit rows).
  - Payment code was not changed. The checkout review found no correctness or security defect. Automatic confirmation only verifies an existing reference and never starts a payment; a reload after success reads the database only; two tabs are serialized by the intent claim; requests are bounded per trigger and rate-limited per user.
  - One user-experience item is left for the owner: after an abandoned checkout the stored reference is kept for 24 hours, so each visit to the lesson shows "Payment was not successful" and makes one Paystack lookup. Changing this touches client payment handling and needs approval.
  - Tests, build and lint ran with outbound network blocked. No tunnel, cloudflared install, dashboard change, checkout, seed, index, migration, dependency change or deploy.

## 8. Next steps (in priority order)

1. Owner review of this change set and of the index migration plan.
2. Finish the Paystack **test-mode** end-to-end run against the isolated dev database, starting with one genuine webhook delivery under `docs/audits/paystack-test-webhook-delivery-plan.md`. This needs owner approval for a temporary tunnel and the test-mode webhook URL. Then a failed payment and a duplicate charge, and a browser check of the ledger. The success path is done (section 2a), and handler-level webhook behavior is covered (section 2b).
3. Read-only duplicate scan (plan section 3) using a read-only user, ideally on a snapshot.
4. Owner decisions: backfill `fo_1…gow7`, refund/dispute policy, and how duplicate and superseded payments are settled.
5. Rehearse and then build the unique indexes (plan sections 5 and 7).
6. Production database role change for the audit log (D9).
7. Decide on D10: accept per-process limits with the current instance count, or approve the Mongo-backed counter and its TTL index plan.
