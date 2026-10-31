# Phase 5: payments, checkout and financial integrity

Branch `feat/phase-5-payments`, from `origin/master` `4ae2c5a` (the released Phase 4.5 code). It is not pushed or deployed. Paystack was called in **test mode only** (section 5.1); no live charge or refund was made.

## 1. What existed (audit summary)

The course purchase system was already mature:

- Server-created checkout intents with an unpredictable reference (`fo_c_<time>_<16 hex>`).
- A fixed server-side price (₦10,000, `lib/course-price.js`; the documented business rule).
- One pending checkout per student and course (partial unique index I2).
- Authoritative verification with Paystack for the browser path, with checks on amount, currency, reference, owner, course and metadata.
- A `processing` claim that stops concurrent double processing.
- Duplicate or late payments held for review instead of granted.
- Signature-checked webhooks on the raw body.
- Unique indexes I1–I6, already built in production.
- The Super Admin ledger, exceptions and audit trail.
- The rate limits and environment gate (a live key only in production).

## 2. Defects and gaps found

| # | Finding | Risk |
|---|---|---|
| G1 | The webhook granted access from the signed payload alone. A leaked secret, or a forged event with a valid signature, would grant without Paystack confirming the transaction. | Integrity |
| G2 | No refunds. `refund.*` events were only recorded as exceptions. There was no way to refund from the app, no refund tracking, and no effect on records. | Missing feature |
| G3 | No reconciliation. A confirmation that crashed after the payment row was written, or a checkout paid while the browser closed and the webhook was lost, needed the student to click "Paid but still locked?". Nothing found these cases automatically or reported discrepancies. | Customer without access |
| G4 | No payment history for students. | Missing feature |
| G5 | The Paystack transaction id was not stored, so refunds could not be looked up later. | Traceability |
| G6 | A webhook `charge.success` with no or blank `data.reference` went through the full confirmation path before being refused. | Robustness |

Decisions respected, not changed: the price stays the fixed server constant (the brief's "price from the database" conflicts with the documented business rule, which Phase 5 may not change). The refund and dispute policy was never decided by the owner, so no global rule was invented (see 3.2).

## 3. What was implemented

### 3.1 Webhook re-verification (G1, G6)

- `lib/course-payment.js`:
  - `confirmCoursePayment` now accepts a `fetchTransaction` for the webhook source. With it, the event only names the reference; Paystack's `GET /transaction/verify` answer is the evidence.
  - A new `reconciliation` source.
  - `processWebhookEvent(db, payload, now, { fetchTransaction, onRefundEvent })` refuses payloads that are not objects or have no reference.
- `pages/api/paystack/webhook.ts` passes the server-side lookups.
  - An uncertain lookup answers 500, so Paystack delivers again.
  - A Paystack answer that contradicts the event (status or amount) grants nothing.
- The Paystack transaction id is stored on the payment row as `providerTransactionId` (additive).

### 3.2 Refunds (G2): `lib/payment-refunds.js`

- **Who:** Super Admin only, from the purchase detail panel (`pages/admin/purchases.tsx`):
  - `POST /api/admin/refunds`;
  - `GET /api/admin/refunds?reference=`;
  - `POST /api/admin/refunds/:id` with `refresh` | `close_uncertain`.
- **Durable first:** a `paystackRefunds` record (status `requested`, `open: true`) is written before `POST https://api.paystack.co/refund` is called, with the secret key, server-side.
- **Duplicates impossible:**
  - a client `requestId` (unique index F1) makes a double submission return the same refund;
  - the partial unique index F2 (`paymentReference` where `open: true`) allows one unfinished refund per payment, so concurrent requests reach Paystack once;
  - F3 makes each Paystack refund id unique.
- **Amounts:**
  - full (empty amount = the remainder) or partial, in whole kobo, at least ₦1;
  - never more than the unrefunded amount; NGN only.
- **Statuses** (one way; final states never change): `requested → pending | processing | needs_attention | processed | failed | request_failed | uncertain`.
  - Unknown Paystack statuses are kept non-final.
  - A timeout or 5xx on creation becomes `uncertain`. It stays open (blocking duplicates) until a refresh finds the refund in Paystack's list for the transaction, or proves after 30 minutes that none exists. The Super Admin may also close it after checking the dashboard (audited).
- **Webhook `refund.*`:**
  - matched by Paystack refund id, else by the single open refund for the payment and amount;
  - re-read with `GET /refund/:id` before a status is applied;
  - an unreachable Paystack answers 500 (retry);
  - a refund id Paystack cannot find is not applied.
- **Effects of a processed refund** (each step idempotent; reconciliation finishes a crashed one):
  1. the payment keeps `status: 'success'` and gains `refundedKobo` and `refundState` (`partially_refunded` | `refunded`);
  2. the purchase row gains the same;
  3. audit entries `refund_requested` and `refund_processed`, with fixed ids so they are written once.
- **Access:** never changed automatically.
  - The Super Admin must choose `revokeAccess` explicitly on every request.
  - Removal is allowed only for a refund that completes a full refund of a payment that granted access.
  - It is applied only when Paystack reports `processed`.
  - The access row is kept (`paid: false`, `entitlementType: 'refunded'`, `revokedAt`, `revokedReason`); never deleted.
  - Refunds made in the Paystack dashboard are recorded as `external` refund records, flagged as exceptions, and never change access.
- Disputes stay recorded for review only (unchanged; no policy exists).

### 3.3 Reconciliation and recovery (G3): `lib/payment-reconciliation.js`

**Repairs** (only what Paystack's answer proves; only through the normal confirmation path, which re-checks amount, currency, owner and course):

- R1: confirmations that stopped while holding the claim (older than 2 minutes).
- R2: pending checkouts aged 10 minutes to 24 hours that Paystack reports paid.
  - Each is checked at most hourly.
  - Unpaid, abandoned or uncertain checkouts stay pending and are never marked failed.
- R3: open refunds refreshed from Paystack; processed refunds whose effects were interrupted are finished.

**Reports** (no writes):

- payment without access;
- duplicate references;
- duplicate entitlements;
- held payments;
- refunds without a record;
- a sample of recent local successes that Paystack does not confirm.

**Bounded:** at most `limit` Paystack calls per pass.

**Entry points:**

- an automatic sweep in `server.js`:
  - every `PAYMENT_RECONCILE_INTERVAL_MINUTES` (default 15; 0 disables);
  - only where payments are enabled, 10 calls per pass, never overlapping itself, counts-only logging;
- `POST /api/admin/payments/reconcile` (Super Admin; a "Run reconciliation" panel on the purchases page);
- `scripts/payment-reconcile.js`: a report-only default; `--apply` and `--verify-sample` follow the payment environment rules.

### 3.4 Payment history (G4)

- `lib/payment-history.js` and `GET /api/payments/history`:
  - only the session user's rows; no parameter can name another user;
  - statuses `paid`, `under_review`, `confirming`, `refund_pending`, `partially_refunded`, `refunded`;
  - course title, amount, date, reference and refund totals;
  - no provider payload, metadata, emails or review notes.
- `pages/payments.tsx` (responsive) and a **Payments** entry in the student menu.
- The ledger's payment view also shows `entitlementApplied`, `refundState` and `refundedKobo`.

### 3.5 Database

- New collection `paystackRefunds`, added to the app role definition (`lib/app-database-role.js`: find, insert, update, remove).
- New unique indexes (`lib/refund-indexes.js`, `scripts/refund-indexes.js`; read-only unless `--apply`; builds only missing ones; refuses unknown or conflicting states; production target rules shared with the certificate and session scripts):

  | Id | Name | Key | Partial filter |
  |---|---|---|---|
  | F1 | `uniq_refund_request` | `{ requestId: 1 }` | none |
  | F2 | `uniq_open_refund_payment` | `{ paymentReference: 1 }` | `{ open: true }` |
  | F3 | `uniq_provider_refund` | `{ providerRefundId: 1 }` | `{ providerRefundId: { $exists: true } }` |

- Additive fields: `providerTransactionId`, `refundedKobo`, `refundState` and `refundUpdatedAt` on payments; `refundState` and `refundedKobo` on purchases; the revocation fields on access rows (only when a refund removes access).
- No migration and no change to existing documents. The existing indexes I1–I6 are unchanged.

### 3.6 Security

- The secret key is used only in server modules (`lib/payment-route.ts`, `lib/course-payment.js`, `lib/payment-refunds.js`, `server.js`). Browser code reads only `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` (`PaystackCourseUnlock`). Both are checked by tests.
- All new routes use `withAuth` (Phase 4.5 cookie sessions, CSRF header and exact Origin). Admin routes are `['superadmin']` plus `superAdminOnly`, and rate-limited (ledger limits).
- The history route takes the user only from the session.
- Logs carry references and outcome codes only; no emails, cards, secrets or provider bodies.

### 3.7 Paystack service fee and pricing (final business decision, 31 October 2026)

**Decision (owner):** the customer pays the Paystack service fee; ForexOrbit does not absorb it. The owner confirmed that the live Paystack account passes the fee to the customer, as the test account does. The course price stays ₦10,000 (`COURSE_PRICE_KOBO`, unchanged).

- **Configuration:** `CUSTOMER_PAYS_PAYSTACK_FEES = true` in `lib/course-price.js`.
- **Verification** (`paysExpectedAmount` in `lib/course-payment.js`, used by confirmation, webhooks, late-event checks, reconciliation and the admin ledger). A transaction pays the course when either:
  - `amount` equals the price; or
  - `requested_amount` equals the price and `amount` is exactly the price plus the `fees` Paystack reports (fees > 0).

  A reported `requested_amount` that is not the price is refused, and nothing below the price passes. The fee is taken from Paystack's answer, not from the displayed estimate, so any legitimate fee (another card type or channel) is accepted.
- **Payment records:** `amountKobo` stays the course price. `chargedKobo` (the total the customer paid) and `customerFeesKobo` (the service fee) are added when they differ (additive fields).
- **Refunds** are of the course price: a full refund returns at most ₦10,000; Paystack keeps its fee.
- **Displayed estimate:** `COURSE_LOCAL_CARD_FEE_KOBO` / `COURSE_LOCAL_CARD_TOTAL_KOBO` (₦253.81 / ₦10,253.81). It is derived from the Nigerian-card fee and equals the test-mode charge exactly. It is labelled an estimate everywhere; the total Paystack shows before the customer confirms is authoritative.
- **Pricing page `/pricing`** (new; linked from the landing page, How it works and the shared footer). Every amount comes from `lib/course-price.js`; a test forbids hard-coded amounts. It shows:
  - price, service fee and total payable (estimate), with a statement that the customer pays the fee and that Paystack's total is exact;
  - what is free (account, enrolling, free previews on selected courses, demo lessons, demo desk, community, consultation booking);
  - how paying works;
  - refunds: each request is reviewed individually through support, and a full refund may end access to that course;
  - FAQs.
- **Checkout card** (`PaystackCourseUnlock`, the compact variant used on course and lesson pages, and the full variant): course price, Paystack service fee (estimate), total payable (estimate), "You pay the service fee. Paystack shows the exact total before you confirm", and a link to Pricing.
- **Wording:** the blanket "the first lesson is free" claims were replaced by "free previews on selected courses" / "free preview and demo lessons stay free" on the pricing page, checkout card, lesson page and How it works.

## 4. Payment lifecycle (now)

**Course page → `POST /api/payments/paystack/init-course`:**

- published course, student account, rate limit;
- an earlier paid checkout is granted instead of charged again; a processing one blocks a new checkout;
- a new intent at the server price; the reference, amount and currency are returned.

**Paystack Inline popup, then the callback → `POST /api/courses/:id/pay`:**

- the server verifies with Paystack;
- a claim, then payment, access, purchase and intent `paid`;
- the browser shows access only after the server says so.

**At the same time, `charge.success` webhook:**

- signature check, then the same confirmation with Paystack re-verification;
- idempotent through the claim and the unique references.

**If both are lost (closed browser, failed webhook), or a process crashed part-way:** the reconciliation sweep confirms it within the next pass.

**Refund:**

- the Super Admin records and submits it to Paystack;
- Paystack's `refund.*` webhook, a refresh or reconciliation moves it to processed;
- the payment summary is updated, and access is removed only if chosen for a full refund.

## 5. Testing (31 October 2026, executed)

| Suite | Result |
|---|---|
Final run, after the service-fee and pricing changes:

| Suite | Result |
|---|---|
| `npm test` (all unit and route tests) | **789/789** (754 before Phase 5; Phase 5 added 3 webhook route tests, 26 in `tests/payments-phase5.test.js`, and 6 fee and pricing tests in `tests/course-purchase.test.js`) |
| Phase 5 logic tests | 26/26. Mutation-checked: removing the partial-refund guard, the webhook re-verification, the open-refund uniqueness, the one-way status rule or the "never mark failed" rule each fails tests |
| Service-fee tests | fee-inclusive payment granted and recorded (price, total, fee); underpayment with fees refused; `requested_amount` below the price refused; fees that do not add up refused; reconciliation accepts reversals only with a local refund; the displayed estimate equals the test-mode charge; source contracts for the pricing page and checkout wording |
| Real MongoDB integration (`npm run test:mongo:payments`, local MongoDB 9.0.4) | **4/4**: index definitions, concurrent refunds (one reaches Paystack), processed full refund, reconciliation |
| Existing real-MongoDB suite (`npm run test:mongo`) | 12/12 |
| TypeScript | 0 errors |
| ESLint (`npm run lint`) | 0 errors; 624 warnings (616 before Phase 5; all new ones are `require()` style in CommonJS libraries and tests, the convention for `lib/*.js`) |
| Production build | passes; `/pricing` is prerendered as static |
| Phase 4 acceptance (real app, headless Edge) | 77/77 |
| Phase 4.5 session end-to-end | 36/36 |
| Phase 5 end-to-end (`scripts/acceptance/payments-e2e.js`, real app, Edge) | **28/28**: history API and isolation; Super Admin-only refund and reconcile routes; CSRF; the safe refusal without a Paystack key; Payments page on desktop and phone; menu link; admin refund panel with explicit access choice; reconcile panel |
| Pricing page (real app, headless Edge; desktop 1366 px and phone 390 px, dark and light) | 4/4: no horizontal overflow; price, fee and total shown; service-fee, refund and free-preview wording present; no "first lesson" claim |

Changed existing tests:

- `tests/paystack-webhook-handler.test.js`: the stubs now provide the Paystack lookups, defaulting to Paystack agreeing with its own event, so every old assertion keeps its meaning.
- Test 7b: a dashboard refund is now recorded as an external refund record, still with access unchanged.

**Not executed:** Firefox, Safari and iOS; any live Paystack charge or refund.

### 5.1 Paystack test mode (31 October 2026, executed)

Test secret and public keys only, held in memory. The app ran locally against a separate local database `forexorbit_p5_paystack_test` with synthetic example.com accounts and test card 4084 0840 8408 4081. No live key, real card or production record was used.

**Defect found and fixed: customer-paid fees.** The test Paystack account passes transaction fees to the customer. Verify then reports `amount` 1,025,381, `requested_amount` 1,000,000 and `fees` 25,381 for a ₦10,000 course. Confirmation, webhooks, reconciliation and the ledger compared `amount` with the price, so every such payment was refused as `amount_mismatch` and nothing was granted. The released code has the same check.

- `paysExpectedAmount` in `lib/course-payment.js` accepts `amount` equal to the price, or exactly the price plus Paystack's reported `fees` when `requested_amount` is the price. A reported `requested_amount` other than the price is always refused, and nothing below the price passes.
- Payment rows keep `amountKobo` as the price and add `chargedKobo` and `customerFeesKobo`.

**Defect found and fixed: refunded payments flagged in reconciliation.** After a refund Paystack reports the transaction as `reversal-pending`, then `reversed`. The sample re-verification flagged these as disagreements. They are now accepted only when a local refund record exists for that payment; a reversal unknown locally is still flagged.

| Step | Result |
|---|---|
| Checkout, test-card charge, direct verify, server confirmation, entitlement, `providerTransactionId` | pass (4 purchases) |
| Payment record keeps the price (1,000,000), the customer-paid total (1,025,381) and the fee (25,381) | pass (final run) |
| Underpayment: a real ₦5,000 test charge (Paystack: amount 517,767, requested 500,000, fees 17,767) against a ₦10,000 checkout is refused as `amount_mismatch`, recorded as an exception, nothing granted | pass (final run) |
| Webhook: invalid or missing signature refused (401); signed `charge.success` re-verified and granted; 2 duplicate deliveries wrote nothing; signed event for an unknown reference granted nothing | pass |
| Partial refund ₦3,000: accepted, same request id replayed returns the same refund, a different request while open is refused (409) | pass |
| Partial refund processed by Paystack (pending → processing → processed, about 25 minutes); `partially_refunded`, access kept | pass |
| Full refund of the remaining ₦7,000 with access removal: access kept until processed, then removed (`entitlementType: refunded`), payment kept as `success` / `refunded` | pass (processed after about 8 minutes) |
| Lost refund response: recorded as uncertain, second refund blocked, refresh found it through `GET /refund?transaction=` and adopted the id; later processed, access kept (no removal chosen) | pass |
| Reconciliation: paid-but-unconfirmed checkout granted from Paystack; second pass repairs nothing; sample re-verification agrees with Paystack after refunds | pass |
| Server log free of keys and account emails; no `Forex_elearning` on the test server | pass |

**How the runs went.** The refund and reconciliation rows above come from the run after the two fixes and its follow-up (7/7). Paystack test mode took about 25 minutes to process the first refund.

The final regression run (after the pricing changes) passed every check through the partial-refund request: checkout, fee fields, underpayment, webhooks and refund idempotency (20 checks). It then waited for Paystack to process the refund. During that wait the machine was suspended or starved of memory for about 2.4 hours, and the Super Admin's test session expired under the Phase 4.5 idle timeout. Every later call was refused with 401, as it should be. Paystack itself reported the transaction as `reversed`, so the refund was processed. That run's refund, reconciliation and lost-response steps therefore did not complete. The payment, refund and reconciliation logic did not change between the passing runs and the final one; only the presentation (pricing page, checkout card, wording) changed.

**Not tested:**

- Delivery of webhooks by Paystack itself. There was no tunnel; events were signed locally with the test secret.
- A signed `refund.processed` event for a refund Paystack had already processed. Refund state was reached through the refresh path.

## 6. Remaining limitations

- **Refund policy:** the owner never decided a global refund or dispute policy. Phase 5 makes it an explicit per-refund Super Admin choice. Disputes are recorded only.
- **Fee estimate:** the displayed ₦253.81 is a Nigerian-card estimate. Other cards and channels cost more; the customer sees the exact total on Paystack. Verification does not depend on the estimate. If Paystack changes its fees, the estimate in `lib/course-price.js` needs updating.
- **Production database role:** the final check fails on excess privileges (section 7).
- **Partial refunds never remove access** (by design).
- **Pending checkouts over 24 hours old** are not polled by the sweep (the existing rule expires them at the next checkout). A late success is still recoverable through "Paid but still locked?" or the ledger.

## 7. Production database and deployment requirements

**Refund indexes: built and verified** (31 October 2026, 18:10 UTC, owner-authorized). `scripts/refund-indexes.js` reported `missing` ×3, built them with `--apply`, then reported `present` ×3:

- F1 `uniq_refund_request`;
- F2 `uniq_open_refund_payment`, partial `{ open: true }`;
- F3 `uniq_provider_refund`, partial `{ providerRefundId: { $exists: true } }`.

Before-and-after snapshots showed no change to any other index (payments, certificates, sessions, learning collections). The only other change was the new, empty `paystackRefunds` collection.

**App role: final check FAILS on excess privileges** (`node scripts/check-db-role.js --database Forex_elearning`, read-only, 31 October 2026, 19:10 UTC):

- `forexorbit_app` now holds only `forexorbitAppRole`. The temporary `forexorbitLearningIndexRole` has been removed.
- `paystackRefunds` has `find, insert, update, remove` (granted).
- `sessions`, `passwordResetTokens`, `paystackPayments`, `userCourseAccess` and `certificates` keep `find, insert, update, remove`. Database-wide: `listCollections` only.
- **FAIL:** `Forex_elearning.paystackRefunds grants more than the role: createCollection, createIndex`. The role definition (`lib/app-database-role.js`) gives those two actions only to the three consultation setup collections. The app never creates the refund collection or its indexes (they are built), so they are not needed.
- **Owner action:** remove `createCollection` and `createIndex` from the `Forex_elearning.paystackRefunds` privilege of `forexorbitAppRole` (keep `find, insert, update, remove`). Then re-run the check; it must report PASS. Database readiness is not complete until it does.

**Remaining requirements:**

1. **Environment:** no new required variable.
   - Optional: `PAYMENT_RECONCILE_INTERVAL_MINUTES` (default 15).
   - Existing: `PAYSTACK_SECRET_KEY` (live, server only), `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` (live, must be set at build time), `APP_ORIGIN`.
2. **Paystack dashboard** (Settings → API Keys & Webhooks, Live): webhook URL `https://forexorbit-academy.onrender.com/api/paystack/webhook`. Refund events reach the same URL. Customer-paid fees: confirmed by the owner.
3. **Order:** role check PASS → push, merge and deploy (none authorized yet).
4. **Released code:** `origin/master` (4ae2c5a, live) compares the charged amount with the price, so a fee-inclusive live payment is refused there until Phase 5 is deployed.
