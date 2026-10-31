# Phase 5: payments, checkout and financial integrity

Branch `feat/phase-5-payments`, from `origin/master` `4ae2c5a` (the released Phase 4.5 code). It is not deployed. Paystack was never called by any test: no charge or refund was made.

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
| `npm test` (all unit and route tests) | **782/782** (754 existing + 3 new webhook route tests + 25 in `tests/payments-phase5.test.js`) |
| New Phase 5 tests | 25/25. Mutation-checked: removing the partial-refund guard, the webhook re-verification, the open-refund uniqueness, the one-way status rule or the "never mark failed" rule each fails tests |
| Real MongoDB integration (`npm run test:mongo:payments`, local MongoDB 9.0.4) | **4/4**: index definitions, concurrent refunds (one reaches Paystack), processed full refund, reconciliation |
| Existing real-MongoDB suite (`npm run test:mongo`) | 12/12 |
| TypeScript | 0 errors |
| ESLint | 0 errors; 624 warnings (616 before; the 8 new are `require()` style in the four new CommonJS libraries, the convention for `lib/*.js`) |
| Production build | passes |
| Phase 4 acceptance (real app, headless Edge) | 77/77 |
| Phase 4.5 session end-to-end | 36/36 |
| Acceptance guard | 4/4 |
| Phase 5 end-to-end (`scripts/acceptance/payments-e2e.js`, real app, Edge) | **28/28**: history API and isolation; Super Admin-only refund and reconcile routes; CSRF; the safe refusal without a Paystack key; Payments page on desktop and phone; menu link; admin refund panel with explicit access choice; reconcile panel |

Changed existing tests:

- `tests/paystack-webhook-handler.test.js`: the stubs now provide the Paystack lookups, defaulting to Paystack agreeing with its own event, so every old assertion keeps its meaning.
- Test 7b: a dashboard refund is now recorded as an external refund record, still with access unchanged.

**Not executed:**

- Any call to the real Paystack API: no test or live charge, refund, verify or list. The refund API request and response shapes follow Paystack's documentation and are covered with stubs only. The `GET /refund?transaction=` list lookup in particular is unverified against Paystack.
- Firefox, Safari and iOS.

## 6. Remaining limitations

- **Refund policy:** the owner never decided a global refund or dispute policy. Phase 5 makes it an explicit per-refund Super Admin choice. Disputes are recorded only.
- **Unverified against Paystack** (see section 5): a controlled test-mode run on a staging service (a test key with an isolated database) is recommended before the first live refund.
- **Partial refunds never remove access** (by design).
- **Pending checkouts over 24 hours old** are not polled by the sweep (the existing rule expires them at the next checkout). A late success is still recoverable through "Paid but still locked?" or the ledger.

## 7. Deployment requirements (owner; nothing applied)

1. **Atlas role:** add `find, insert, update, remove` on `Forex_elearning.paystackRefunds` to `forexorbitAppRole`. Then `node scripts/check-db-role.js --database Forex_elearning` must report PASS.
2. **Indexes:** run `scripts/refund-indexes.js --database Forex_elearning` read-only, then `--apply` with a privileged account (connection file outside Git). Expect F1–F3 `present`.
3. **Environment:** no new required variable.
   - Optional: `PAYMENT_RECONCILE_INTERVAL_MINUTES` (default 15).
   - Existing: `PAYSTACK_SECRET_KEY` (live, server only), `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` (live, must be set at build time), `APP_ORIGIN`.
4. **Paystack dashboard** (Settings → API Keys & Webhooks, Live): webhook URL `https://forexorbit-academy.onrender.com/api/paystack/webhook`. Refund events reach the same URL.
5. **Order:** role → indexes → deploy. Without the role grant:
   - refund requests fail (insert refused);
   - the payment history page answers 500 for students who have payments (it reads `paystackRefunds`);
   - the reconciliation sweep logs a failure on every pass.

   Checkout, confirmation and webhooks for `charge.success` keep working, because they do not touch `paystackRefunds`.
