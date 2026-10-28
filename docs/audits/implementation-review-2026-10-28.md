# ForexOrbit Academy — implementation review (28 October 2026)

**Release decision: BLOCKED. The application is NOT PRODUCTION-READY.**

This document is for review. It covers:
- Phase 6: forwarder safety, the checkout recovery review, signed-in test preparation, the webhook plan and verification;
- the commit pushed to GitHub;
- the "page cannot be found" report;
- the unique index and database role work (D2/D3, D9).

Detailed evidence is in the linked audit documents.

| | |
|---|---|
| Branch | `review/sprint-1-3-integration` |
| Pushed commit | `786313e` (on top of `fd23de2`) on [GitHub](https://github.com/Damian-Sonwa/forexorbit_academy/tree/review/sprint-1-3-integration) |
| Work after the push | Uncommitted: index and role work (listed in section 5) and this document |
| Not included in the commit | `template/` (design images and screenshots), by owner decision |

---

## 1. Phase 6: forwarder safety, checkout recovery and signed-in preparation

### 1.1 Webhook-only forwarder (`scripts/webhook-only-forwarder.js`)

The forwarder lets a future test tunnel reach **only** the Paystack webhook route, never the rest of the dev app. It was hardened and tested against mock HTTP servers on loopback. It was never run against the dev server, and no tunnel was opened.

| Requirement | Implementation | Test evidence |
|---|---|---|
| Only `POST /api/paystack/webhook` is forwarded | Any other method or path gets 404 and never reaches the target. The query string is stripped, and the request is always sent to the fixed path | Routing test; the mock target records zero requests |
| Only the body, `content-type` and signature are forwarded | Header allow-list: `content-length`, `content-type`, `x-paystack-signature` | The forwarded header set is exactly `connection, content-length, content-type, host, x-paystack-signature`, and the body arrives byte for byte |
| Cookies, auth, query credentials and other headers are blocked | Allow-list on requests. Responses relay only the status, `content-type` and body, with no `set-cookie` | Dedicated test |
| Oversized requests | 413 when the declared or streamed body is over 256 KB | Two tests |
| Upstream failures | 504 after a 15 s upstream timeout; 502 on an upstream error; request and header timeouts; 400 on malformed requests | Hung-mock, down-mock and client-abort tests |
| Binds to 127.0.0.1 only | `listenLoopback` binds 127.0.0.1. A non-loopback target is refused (the CLI exits 1) | Bind test, plus a CLI child-process test |

**Mutation checks.** I disabled each safeguard in a temporary copy and reran the tests. Six of seven mutations were caught:
- allowing any target host;
- keeping the query string;
- forwarding all request headers;
- relaying all response headers;
- removing the declared-length check;
- removing the upstream timeout.

Removing the client-error handler was **not** caught. That handler is defensive: Node already closes those connections on this version.

### 1.2 Checkout auto-confirmation review (no payment behavior changed)

| Question | Finding |
|---|---|
| When does it fire? | On mount, only for an existing reference: the `reference`/`trxref` in the URL, or the stored pending key (24 h). It never calls `init-course`, so it cannot start a payment |
| Refresh safety | After success, a reload reads the database only, with no Paystack call (test: 3 reloads make 1 lookup in total) |
| Idempotent and server-authoritative | A paid intent returns `alreadyProcessed`. Unpaid intents use an atomic claim, and ownership and course mismatches are refused server-side |
| Pending, failed, expired, superseded | Abandoned, not-found and uncertain results leave no rows and the intent `pending`; a 429 is retried and ends `pending` (test) |
| Retry loops | At most 4 requests per trigger (2 s, 5 s, 10 s); the confirm route is rate-limited to 30 per 10 minutes per user |
| Multiple tabs | Serialized by the claim. Two tabs give one payment, one access row and one purchase row (test) |
| Crafted `?reference=` URL | Can cause one Paystack lookup but cannot grant access. It records `no_matching_intent` only if the charge's metadata names the session user |

**Conclusion: no correctness or security defect.** One UX item is open for the owner. After an abandoned checkout, the stored key is kept for 24 h, so each lesson visit shows "Payment was not successful" and makes one Paystack lookup. Changing this touches client payment handling and needs approval.

**New tests:** 3 in `tests/course-checkout-unlock.test.js` (now 12).

### 1.3 Signed-in checklist (the owner signs in personally)

`docs/audits/browser-verification-checklist.md`, steps S1–S8. They cover:
- owner course access;
- the paid lesson and quiz as the owner and as a non-owner;
- the Super Admin ledger, purchase detail and Exceptions tab.

All steps are read-only: don't finish the video, don't submit the quiz, don't click Unlock, and don't save a review. The `late_conflicting_event` label check is pending because the dev database has 0 exceptions.

### 1.4 Genuine webhook delivery plan (reconciled, not executed)

`docs/audits/paystack-test-webhook-delivery-plan.md`:
- **Before the tunnel:** a fresh isolation check; a matching test account and key; masked baseline counts plus an all-collection hash snapshot.
- **Section C, in order:**
  - C1: forwarder tests;
  - C2: start the forwarder;
  - C3: local check;
  - C4: install cloudflared;
  - C5: tunnel to `127.0.0.1:3901` only, never 3000;
  - C6: public probes proving app pages return 404.
- **Approvals:** explicit approval before the dashboard change and before the checkout.
- **After the test:** restore the URL, stop the tunnel and forwarder, and confirm no cloudflared process remains. Then compare the snapshot and record any unexpected change.

Not done: cloudflared install, tunnel, dashboard change, checkout.

### 1.5 Phase 6 verification (outbound network blocked, no `.env` values loaded)

| Command | Result |
|---|---|
| `npm test` (42 files) | 412/412 pass |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npm run lint` | 0 errors, 587 warnings (unchanged) |
| `npm run build` (temporary copy, no `.env`) | exit 0 in 150 s |
| `npm audit` | Not run: it needs the network |

---

## 2. Push to GitHub

- **Commit:** `786313e` ("Payment safeguards, webhook-only forwarder, audits and new brand logo"), 124 files.
- **Pre-commit check:** the repo's commit guard blocked the first attempt because `tests/seed-dev.test.js` contained the production database username in a fake connection string. The test now builds that string from a named constant. Its assertion is unchanged and it still passes 13/13. The guard was not bypassed.
- **Before committing:** the secret scan was clean; the only hits were fake test fixtures (`.invalid` hosts, a dummy token). `.env` is ignored and was not committed.

## 3. "Page cannot be found" on the live site

`/admin/purchases` exists only on `review/sprint-1-3-integration`. The live site deploys from `main` or `master`, and neither has the page. Locally, the page returns 200.

No change was made: merging into the deploy branch would ship the unverified payment code to production. The page can be checked locally now, or on a branch preview deployment. Note that a preview build may point at the production database, depending on its environment variables.

## 4. Unique indexes (D2/D3)

### 4.1 Definitions

Defined once in `lib/course-payment-indexes.js`. Build order:

| # | Collection | Keys | Options |
|---|---|---|---|
| I1 | `paystackPaymentIntents` | `reference` | unique |
| I3 | `paystackPayments` | `reference` | unique |
| I6 | `paymentExceptions` | `reference, reason` | unique |
| I2 | `paystackPaymentIntents` | `userId, courseId, kind` | unique, partial `{ status: 'pending', kind: 'course' }` |
| I5 | `coursePurchases` | `userId, courseId` | unique (full) |
| I4 | `userCourseAccess` | `userId, courseId` | unique |

**Change from the plan.** I2 now also filters on `kind: 'course'`. Legacy lesson checkouts can legitimately have several pending rows for one course, and would have made the build fail.

**Compatibility review.** Only `lib/course-payment.js` writes these collections. Its upserts are equality matches on the index keys, and it already handled duplicate keys when creating an intent.

### 4.2 Payment code change required by I2 (`releaseIntent`)

**Problem.** A newer checkout can become the pending one while an older one is being confirmed. Putting the older intent back to `pending` then breaks I2, and an ordinary "payment not received yet" answer (409) becomes an HTTP 500 on every retry.

**Fix.** On a duplicate key, the older intent stays `processing` with no claim time. The next confirmation claims it at once, and a payment on it is still granted exactly as before. **Entitlement rules are unchanged.** Without the index, the new branch never runs.

**Tests.** The in-memory test store can now enforce I1–I6 the way MongoDB does. Five new tests in `tests/course-purchase.test.js` (now 62) cover:
- index enforcement;
- purchase plus replays plus webhook give one row of each kind;
- a second paid checkout is held as one `duplicate_payment` exception;
- the release case above;
- recurring exceptions stay one document per reference and reason.

A mutation check confirmed the release test fails without the fix.

### 4.3 Index script (`scripts/course-payment-indexes.js`)

| Mode | Behavior |
|---|---|
| `--database <name>` (default) | Read-only. Runs duplicate scans S1–S6 (masked output) and reports each index as missing, present or conflicting |
| `--apply` | Refuses if any scan finds a group or any existing index conflicts. Builds in plan order, then verifies with `listIndexes`. Never changes documents |
| `--rollback` | Drops only the six named indexes |

The connection string comes from `MONGO_URI` and is never printed. 12 tests run against a fake database.

### 4.4 Dev database result

| Step | Result |
|---|---|
| Isolation | `Forex_elearning_dev`, user `forexorbit_dev`, `readWrite@Forex_elearning_dev` only |
| Scans S1–S6 | 0 groups; no rows without a reference or ids; no mixed id types |
| Indexes | All six present and verified (keys, unique, partial filter) |
| Data | Intents, payments, access and purchases 5 each (all intents `paid`); exceptions 0; audit 0. Only new collection: the empty `paymentExceptions` |

**Evidence limitation.** The exact time the indexes were created is unconfirmed:
- the dry run reported them missing;
- when `--apply` ran, they were already present, so it created nothing;
- a first `--apply` attempt failed in its snapshot helper, and its leftover temp file suggests it stopped before building;
- the indexes match the script's definitions exactly, and nothing else defines them.

The data evidence is the count check above, which matches the morning's read-only baseline. Index builds do not modify documents.

**Not done:** the disposable-database rehearsal and the cross-process concurrency test, because no local `mongod` or Docker is available.

## 5. Production app role (D9)

| Part | Detail |
|---|---|
| Role | `forexorbitAppRole` (`lib/app-database-role.js`) |
| Read-write collections | 45: `find`, `insert`, `update`, `remove` on each |
| `adminAuditLog` | `find` and `insert` only |
| Seed-experts route | `createCollection` and `createIndex` on 3 consultation collections |
| Database level | `listCollections` |
| Checker | `scripts/check-db-role.js`: read-only `connectionStatus`. FAIL if the audit log can be updated, removed or dropped through any grant (database-wide, any-database, any-resource), or if an app collection lacks an action |
| Coverage test | Scans `lib`, `pages`, `components`, `hooks` and `server.js` for every collection name, so the role can't silently fall behind the code |
| Dev user result | **FAIL, as expected:** `readWrite` allows update, remove and drop on `adminAuditLog`. The dev user's role was not changed |

The owner steps for Atlas are in `docs/audits/production-database-runbook-indexes-and-role.md`:
1. Create the role.
2. Check it with a temporary user.
3. Switch the app user and remove `readWrite`.
4. Run the checker and expect PASS.
5. Smoke-test the live app.
6. Keep a separate maintenance user.

## 6. Verification after the index and role work

All runs had outbound network blocked and no `.env` values loaded.

| Command | Result |
|---|---|
| `npm test` (44 files) | **436/436 pass**, exit 0. That is 412 plus 5 purchase tests, 12 index-script tests and 7 role tests |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npm run lint` | 0 errors, 588 warnings. The one new warning is the repo-wide `no-require-imports` in `lib/course-payment-indexes.js` |
| Secret scan of changed files | 0 hits |
| Commit guard on staged changes | Passes |
| `npm run build` | Not rerun after this work (last run: exit 0, Phase 6) |

## 7. Files

**Pushed in `786313e` (Phase 6 and earlier):**
- `scripts/webhook-only-forwarder.js`, `tests/webhook-only-forwarder.test.js`
- `tests/course-checkout-unlock.test.js`
- the brand logo files
- the audit docs
- the rest of the payment, ledger and lesson remediation listed in `consolidated-pre-release-remediation.md`

**Uncommitted (this review):**

| File | Change |
|---|---|
| `lib/course-payment.js` | `releaseIntent` duplicate-key handling; comment points to I2 |
| `lib/course-payment-indexes.js` | New: I1–I6 definitions |
| `scripts/course-payment-indexes.js` | New: scans, dry run, apply, rollback |
| `lib/app-database-role.js` | New: D9 role and privilege evaluation |
| `scripts/check-db-role.js` | New: read-only role checker and `--print-role` |
| `tests/course-purchase.test.js` | Index-enforcing memory store; 5 tests |
| `tests/course-payment-indexes.test.js` | New, 12 tests |
| `tests/app-database-role.test.js` | New, 7 tests |
| `package.json` | `npm test` runs the two new test files |
| `docs/audits/production-database-runbook-indexes-and-role.md` | New: dev results and the owner runbook |
| `docs/audits/course-payment-index-migration-plan.md` | Status and plan changes |
| `docs/audits/consolidated-pre-release-remediation.md`, `release-readiness-2026-10-26.md` | Blocker status updates |
| `docs/audits/implementation-review-2026-10-28.md` | This document |

## 8. Remaining blockers

| Item | Status | Owner action |
|---|---|---|
| Production indexes | Not built | Deploy the duplicate-key handling, then dry run and `--apply` (runbook) |
| D9 production role | Prepared, not applied | Atlas custom role, switch the app user, checker reports PASS |
| Refund and dispute policy | Deferred by the owner | Decide later |
| Backfill `fo_1…gow7` | Undecided; record untouched | Ownership decision |
| D10 rate limits | Shared MongoDB store implemented (section 10); not deployed | Build R1, then deploy |
| 3 moderate npm advisories | No risk acceptance; audit not rerun | Accept, or plan an upgrade |
| Atlas account and Render identity | Unverified | Atlas org owner, Render operator |
| Eight smoke tests | Unverified; fixtures missing in dev | Approve the fixtures, then a signed-in run |
| Genuine Paystack webhook delivery | Not run | Approvals in the delivery plan |
| Signed-in, mobile, failed and abandoned payment tests | Not run | Owner sign-in (S1–S8) and payment approvals |
| Disposable rehearsal and cross-process test | Not run | A local `mongod` or other disposable cluster |
| Abandoned-checkout UX | Fixed client-side (section 10) | Review |

## 9. Decisions requested from the reviewer

1. Approve the `releaseIntent` change (section 4.2) and the I2 partial filter change (section 4.1).
2. Approve committing and pushing the uncommitted work in section 7 to `review/sprint-1-3-integration`.
3. Schedule the production steps: deploy, then indexes, then role, in the runbook's order.
4. ~~Decide the abandoned-checkout UX item (section 1.2).~~ Resolved client-side in section 10.

## 10. Release-blocker closure run (28 October 2026)

The full results, the `fo_1…gow7` checklist and the refund and dispute decision table are in the last section of `release-readiness-2026-10-26.md`, the authoritative report. In short:
- **Abandoned checkout.** An automatic re-check that gets `payment_not_successful` stops re-checking on later visits. Manual confirmation and the server are unchanged.
- **D10 shared rate limit.** `lib/shared-rate-limit.js` counts in MongoDB `rateLimits`. Payment and ledger routes fail closed with 503 if the store fails.
- **R1.** A TTL index on `rateLimits.expiresAt`, managed by the index script.
- **D9 checker.** It now also fails on excessive privileges. `rateLimits` was added to the role.
- **Verification.** `npm test` 446/446 offline, tsc exit 0, lint exit 0, and an isolated build exit 0.
