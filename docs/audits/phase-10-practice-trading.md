# Phase 10: Practice Trading Environment (Audit)

**Baseline:** `be477d6` (`feat: complete phase 9 assessments`), parent `e78ce9b`.
**Branch and worktree:** `feat/phase-10-practice-trading`, `C:\Users\Juliet\Downloads\forexorbit_academy-phase-10-practice-trading`
**Scope source:** `ForexOrbit_Academy_Master_Engineering_Roadmap.pdf`, "Phase 10 -- Practice Trading Environment" (page 9).
**Date:** 4 November 2026.
**Status:** G0-G10 implemented and verified, uncommitted. **Blocked from student use: no market-data source is approved.** See section 23, which takes precedence over earlier sections.

**How to read the labels**
- **Confirmed:** proven by running the real route handlers, or unambiguous in the code.
- **Suspected:** likely, but depends on something this audit could not check, such as OANDA's live behaviour.
- **Optional:** an improvement, not a defect.

**How evidence was gathered:** real route handlers ran against an in-memory database with a fake broker or a stubbed `fetch`. No database was written and no external trading API was called. The one MongoDB command used was a read-only `$documents` aggregation to check decimal behaviour. Production was not inspected.

---

## 1. Executive summary

**A practice-trading feature exists, but it cannot do what the roadmap requires, and it should not be repaired in place.** It is a thin pass-through to a broker API, with no execution engine, ledger, positions or account rules of its own. Phase 10 needs a server-side simulator, using an external provider for prices only.

**What a student gets today.** The "Practice account" tab by default sends students to external OANDA and MetaTrader sites. If `NEXT_PUBLIC_BROKER_API_ENABLED` is `true`, a button creates an account, but then:

- orders go to an invented OANDA account id (P10-01);
- displayed prices are `Math.random()` output (P10-02);
- the balance is whatever the browser sent, including negative numbers and text (P10-03);
- nothing checks funds, margin or order size (P10-04);
- every trade's P&L computes to zero, and the page displays those figures as performance (P10-05).

**What works and is worth keeping:** the manual trade journal, with ownership correctly enforced, plus the instructor task, submission and review workflow, role checks, and the `withAuth` session and CSRF layer on POST routes.

| Priority | Count | Examples |
|---|---|---|
| P0 | 6 | No viable execution model, random prices, client-set balance, no funds checks, mock P&L, no ledger |
| P1 | 10 | Close by GET without CSRF, no idempotency, duplicate accounts, floating-point money, silent outage data |
| P2 | 11 | Task completion shared between students, cross-student submission, state change by GET on task completion |
| P3 | 6 | No tests, no indexes, N+1 reads |
| P4 | 2 | Stale documents, unimplemented mock broker |

**Direction (approved 4 November 2026):** an internal, server-side simulator, starting on recorded historical market data (D1, D2, section 15.1). G0 has already removed the random prices and mock performance, and made position close POST-only (section 17.1). The audit findings below describe the code as it stood at `be477d6`; section 13.1 gives each affected finding's status after G0.

**Risk to note:** Phases 7, 8 and 9 are unreleased. Phase 10 would be a fourth stacked phase (section 16).

---

## 2. Verified Phase 10 baseline and architecture

### 2.1 Phase 9 handover (verified, not assumed)

| Check | Result |
|---|---|
| Phase 9 commit | `be477d68efa0489f78352a090278d4a306cb060f`, 54 files, on `feat/phase-9-assessments` |
| Phase 9 worktree | Clean: 0 modified, 0 untracked, stash empty |
| Phase 9 report | 35 findings: 32 resolved, 1 partial (P9-22), 2 outstanding (P9-14, P9-29) |
| `origin/master` | `0935557`, confirmed on the remote. Branch is 3 ahead, 0 behind, no divergence |
| Phase 10 branch | Created from `be477d6`; none existed before |

**Carried forward:** P9-14 (production role and indexes) and P9-29 (baseline rate-limit test flakes) stay open. P9-22 stays partial. None blocks this audit.

### 2.2 Architecture today

```
pages/demo-trading.tsx ── components/TradingInterface.tsx (random prices, client display)
        │
pages/api/demo-trading/*  (account, trades, positions/:id/close, performance)
        │
lib/brokers/  BrokerFactory -> OandaBroker (only implementation; fxcm and mock throw)
        │
OANDA v20 practice API (external)      MongoDB: demoAccounts, demoTrades (write-only copy)
```

### 2.3 Platform facts that limit the design

| Fact | Evidence | Consequence |
|---|---|---|
| Local MongoDB 9.0.4 is standalone | `db.hello()` has no `setName` | Transactions cannot be tested locally as configured |
| Production is an Atlas cluster | `docs/release/production-database-preparation.md` | Transactions are probably available. **Topology not verified** |
| The app uses no transactions anywhere | No `withTransaction` in `lib`, `pages`, `scripts` | Phases 5-9 use recoverable workflows |
| One always-on Render instance, plan `starter` | `render.yaml`, `render-production-configuration.md` | A background job is viable; confirm the plan in the dashboard |
| `server.js` already runs interval jobs | Payment reconciler, `server.js:870-897` | A pattern exists for order evaluation |
| No decimal library is installed | `package.json` | Decide BigInt or a dependency (section 6) |
| Decimal128 adds exactly on this server | `$add` of 0.1 and 0.2 gives `0.3`; doubles give `0.30000000000000004` | Suitable for storage |

---

## 3. Existing trading capabilities

| Capability | State | Evidence |
|---|---|---|
| Disclaimer that the desk is educational | **Works** | `pages/demo-trading.tsx:354-367` |
| Student-only access to account, trades, performance | **Works** | `withAuth(..., ['student'])`; an instructor got 403 |
| CSRF and Origin on POST routes | **Works** | `withAuth` |
| Manual trade journal: create, list, edit, delete | **Works**, input weak (P10-20) | Routes and probe |
| Journal ownership | **Works** | Another student: 403 on edit and delete, empty list |
| Journal screenshots through Cloudinary | Present, not exercised | `journal/upload.ts` |
| AI feedback on journal entries | Present, needs AI configured | `lib/ai.ts` |
| Instructor tasks, submissions, review, notifications | **Works**, with defects (P10-17, P10-18) | `tasks/*`, `submissions/*`, `demo-submissions/[id]/review.ts` |
| Index on the journal | **Exists**: L5 `perf_journal_student_recent` | `lib/learning-indexes.js` |
| Role coverage for demo collections | **Exists** | `lib/app-database-role.js` |
| Broker abstraction | Present, one implementation | `lib/brokers/` |
| Broker methods for prices, candles, cancel | **Written but never called** | No route uses `getPrices`, `getCandles` or `cancelOrder` |

---

## 4. Missing and partially implemented capabilities

| Roadmap scope | State |
|---|---|
| Virtual account creation | **Partial and unsafe** (P10-01, P10-03) |
| Starting balance rules | Missing: client-controlled |
| Reset rules and history | **Missing**: no route, field or history |
| Account lifecycle and status | Missing: no status field |
| Account ownership | Partial: by `studentId`, not unique (P10-09) |
| Market data source | **Missing in practice**: no price route (P10-02) |
| Timestamps, stale handling, availability | **Missing** (P10-16) |
| Order types | Partial: market, limit and stop forwarded to the broker |
| Order validation | **Missing** beyond presence and enum checks (P10-04) |
| Order lifecycle | **Missing**: stored status never updates (P10-24) |
| Open positions | Read from the broker only; nothing stored |
| Closing trades | Forwarded to the broker; not recorded (P10-06) |
| Partial close | Missing |
| Stop-loss and take-profit | Forwarded only; no server rule or validation |
| Pending-order cancel and expiry | Missing route; no expiry |
| Balance, equity, margin, leverage | **Missing**: no calculation anywhere in the app |
| Fees, spread policy | Missing |
| Realized and unrealized P&L | **Missing**: mock (P10-05) |
| Trade history | Partial, broker-derived; `demoTrades` is a stale copy |
| Portfolio valuation | Missing |
| Journal linked to real trades | Missing: fully self-reported |
| Trading leaderboard | **Missing**: no trading rankings exist |
| Concurrency control, transactions | **Missing** |
| Decimal precision | **Missing** |
| Demo isolation | **Not achievable with the current design** (P10-01) |

---

## 5. Complete account, order, execution and position data flows

### 5.1 Account creation (actual)

1. The browser posts `{ initialBalance }`, fixed at 10000 in the UI but unrestricted on the server.
2. The route checks for an existing account, then later inserts. There is no atomic guard (P10-09).
3. `OandaBroker.createDemoAccount` reads the one shared account from `OANDA_ACCOUNT_ID`, then returns an invented id `<accountId>_<studentId>` and the **requested** balance.
4. That id and balance are stored.

### 5.2 Order (actual)

1. The browser posts order fields.
2. The route checks presence and enums only. It does not read a price, the balance or a limit.
3. `parseFloat` converts values, so non-numbers become `NaN`.
4. The broker is called with the invented id: `POST /v3/accounts/101-004-1234567-001_<studentId>/orders` (observed in the probe).
5. On success a row is inserted into `demoTrades`, and that row is never updated again.

**Failure point:** an order accepted by the broker with a failed insert leaves an untracked order (P10-11).

### 5.3 Position close (actual)

1. Any HTTP method reaches the handler (P10-07).
2. The broker lists positions, finds a match and closes it.
3. Nothing records the close, the exit price or the P&L (P10-06).

### 5.4 Balance

The stored balance is overwritten from `broker.getAccount`, which for the invented id should fail. The GET route then returns the stored value with status 200 and no warning (P10-12). So the displayed balance is effectively the number the browser chose.

### 5.5 Required flow (proposed, needs approval)

```
Client order + clientOrderId
  -> validate (instrument, units, stops, account active)
  -> insert order (unique accountId + clientOrderId)   retry returns the same order
  -> read fresh quote (reject stale, missing, market closed)
  -> compute margin and fill with decimal math
  -> atomic conditional update on the account (funds, version)
  -> write position and ledger entry (deterministic ids)
  -> clear pending flag; recoverable at each step
```

---

## 6. Financial calculation and precision assessment

**Finding: no authoritative financial calculation exists.** Equity, margin, leverage, fees and P&L are not computed by this application. Values are taken from the broker, or are mock.

| Item | State |
|---|---|
| Balance | Client-set, then overwritten by the broker if reachable |
| Equity, free margin, margin level | Not computed |
| Used margin | Broker value only |
| Spread, fees | None |
| Realized P&L | Zero by construction: `entryPrice` and `exitPrice` are the same variable (`lib/performance-metrics.ts:26-27`). Buy at 1.1000 and sell at 1.2000 gave 2 trades, 0 wins, 0 losses, net 0 |
| Unrealized P&L | Broker value |
| Currency conversion | None |
| Risk scores | Heuristics on missing data; "consistency" is computed from zeros |

**Floating point, measured:**

| Expression | Result |
|---|---|
| `0.1 + 0.2` | `0.30000000000000004` |
| 100,000 additions of 0.1 | `10000.000000018848` |
| `(1.1 - 1.0999) * 100000` | `9.999999999998899` |

Every money and price field uses `parseFloat` or plain numbers, and the UI formats with `toFixed`.

**Recommended strategy (D13):**
- Compute in fixed-point integers with `BigInt`, in one pure library (no new dependency).
- Scale prices to 5 decimals, and to 3 for JPY pairs (per-instrument `pricePrecision`).
- Keep money at a fixed internal precision, and round once, at each posting to the ledger.
- Store as MongoDB `Decimal128` (exact, sortable, verified above), and send strings in JSON.
- Rounding: half-even or half-up must be fixed once (D13). Never round between intermediate steps.

**Proposed formulas (for approval, not yet policy):**

| Value | Formula |
|---|---|
| Notional | `units x price`, converted to account currency |
| Used margin | `notional / leverage` |
| Unrealized P&L, long | `(bid - entry) x units`, converted |
| Unrealized P&L, short | `(entry - ask) x units`, converted |
| Equity | `balance + sum(unrealized P&L)` |
| Free margin | `equity - used margin` |
| Margin level | `equity / used margin x 100` |
| Balance | Sum of the ledger; must always reconcile |

Long positions open at ask and close at bid; shorts the reverse. So spread is a real, visible cost with no separate fee.

**Currency conversion:** with USD accounts, `EUR_USD` P&L is already in USD, while `USD_JPY` needs converting at the close rate, and crosses need a second quote. Limiting instruments to USD-quoted and USD-base pairs at first keeps this simple (D3).

---

## 7. Market-data assessment

**Current state: no market data reaches the application.**

| Area | Finding |
|---|---|
| Providers | OANDA code only, and pricing is never called |
| Instruments | 6 pairs hard-coded in the UI; the server accepts anything (P10-15) |
| Displayed prices | `1.0 + Math.random() * 0.1`, every 5 seconds, for all pairs. `USD_JPY` shows about 1.05; ask can be below bid (P10-02) |
| Timestamps | `getPrices` parses a time, but nothing uses it |
| Freshness | None |
| Weekends, sessions | None |
| Outage, retries, fallback | None; failures are silently hidden (P10-12) |
| Historical data | `getCandles` exists and is unused; no stored prices for replay |

**Required rule:** a quote without a recent, valid timestamp never executes an order. The order is rejected with a clear reason. Prices are never invented and stale prices are never silently used.

**Provider options.** Figures come from third-party comparison blogs (checked July 2026 at best) and sources conflict. **All must be confirmed on the providers' own pages before any decision.** Redistribution and display rights were not confirmed for any provider. No account was created.

| Option | Reported cost | Bid/ask | Main concern |
|---|---|---|---|
| OANDA v20 practice API (code already exists) | Free with a practice account; token issued after accepting an API license | Yes, per its pricing endpoint | **Terms for showing prices to many users are unverified.** It is one account's token, so a single point of failure |
| Twelve Data | Free tier reported at 800 requests a day, 8 a minute; paid plans reported from about $29-79 a month | To be confirmed | Sources disagree on WebSocket access; display rights unconfirmed |
| Finnhub | Free tier reported at 60 calls a minute | To be confirmed | Sources disagree on delay and coverage |
| Massive (formerly Polygon) | Paid reported from about $29 a month | To be confirmed | Free-tier details conflict |
| Recorded or synthetic feed | No provider cost | Set by us | Not live; must be labelled honestly. Fully reproducible, ideal for tests |

**Sizing:** 6 pairs polled by the server every few seconds is far beyond an 800-a-day tier, so a free tier would allow only slow refreshes, and students must never call the provider directly. One server-side poller with a shared cache keeps usage independent of student numbers.

**Approved direction (D2, section 15.1):** begin with recorded, timestamped historical data behind a `PriceSource` interface. Its source, licensing, redistribution rights and permitted educational use must be verified **before adoption**, so no dataset has been chosen yet. Live data can be considered later, after a licensing and cost review (OANDA lists `api@oanda.com` as its contact).

---

## 8. Security and authorization findings

| Area | Result | Finding |
|---|---|---|
| Account ownership | Queries are scoped to the session's `studentId` | Good, but not sufficient (P10-01) |
| Object-level access | Journal and submissions enforce ownership. Positions depend entirely on a shared broker account | P10-01 |
| Cross-user trades | **Cannot be isolated** on one shared OANDA account | P10-01 |
| Request validation | Largely absent | P10-04, P10-15, P10-20 |
| Mass assignment | Fields are picked explicitly in routes; no direct body spreads | Good |
| Server-side price and quantity | None | P10-04, P10-16 |
| Client balance manipulation | **Yes**, at creation | P10-03 |
| Replay and duplicates | No protection | P10-08 |
| State change by GET | **Yes** | P10-07 |
| Rate limiting | None on any demo-trading route | P10-14 |
| Audit logging | None for trading | P10-06 |
| Sensitive data | Broker ids and the email in `accountName` are returned and stored | P10-23 |
| Caching | No `no-store` on private responses | P10-22 |
| Real-money protection | `isDemo` is a hard-coded flag, not a check of the actual target | P10-13 |
| Instructor scope | Any instructor can run AI analysis on any student's journal | P10-19 |

---

## 9. Concurrency and consistency findings

| # | Risk from the brief | Today | Required strategy |
|---|---|---|---|
| 1 | Two orders spending one balance | **Unprotected**: nothing checks funds | Conditional update on the account (`version` and funds) |
| 2 | Duplicate orders from retries | **Confirmed**: same request twice made 2 orders and 2 rows | Unique `{ accountId, clientOrderId }`; a retry returns the stored order |
| 3 | Two concurrent closes | Unprotected; depends on the broker | Conditional update on `status: 'open'`; loser gets the stored close |
| 4 | SL and TP triggering together | Not handled | One terminal transition; a fixed rule when both are crossed (D8) |
| 5 | Pending orders executing twice | Not handled | Conditional `pending -> filled`; deterministic position id |
| 6 | Price change between validation and execution | Not handled | Read the quote once; the fill records that quote id and time |
| 7 | Stale or missing data | **No checks** | Maximum quote age; reject with a reason |
| 8 | Rounding accumulation | **Confirmed** float drift | Fixed-point; round once per ledger posting |
| 9 | Reset racing an order | No reset exists | Account `generation`; every operation is conditional on it |
| 10 | Inconsistent records after partial failure | **Confirmed** by reading: three unprotected steps in `placeOrder` | Recoverable workflow plus reconciliation |

**Also confirmed:** 4 parallel account creates produced **4 rows** for one student (P10-09).

**Recommended strategy: recoverable workflow, not transactions (D12).**
- It matches Phases 5-9 and the Phase 9 `effectsPending` pattern, and it works on any topology.
- The account document is the single point of contention. Every money change is one atomic conditional update on it, with a `version`.
- The order carries a pending flag until position and ledger writes are confirmed.
- Position and ledger ids are deterministic, so retries cannot duplicate.
- A sweep finishes interrupted work and checks that balance equals the ledger.

**Alternative:** multi-document transactions on Atlas are simpler to reason about. But they need the production topology confirmed, and local tests would need a replica-set `mongod`, which is an environment change.

---

## 10. Database models, indexes and migration requirements

### 10.1 Existing

| Collection | Use | Indexes | Assessment |
|---|---|---|---|
| `demoAccounts` | One per student, in intent | **None** | Keep read-only; see migration below |
| `demoTrades` | Write-only copy of orders | **None** | Legacy |
| `demoTradeJournal` | Manual journal | L5 | Keep |
| `demoTasks`, `demoTaskSubmissions` | Instructor tasks | **None** | Keep; fix defects |
| `Screenshots` | Upload metadata | None | Keep |

### 10.2 Proposed (design only, nothing created)

| Collection | Purpose | Key indexes |
|---|---|---|
| `tradingAccounts` | Balance, used margin, status, leverage, generation, version | Unique active account per user (D4) |
| `tradingOrders` | Request, status, reason, quote used | Unique `{ accountId, clientOrderId }`; `{ status, instrument }` for pending |
| `tradingPositions` | Entry, units, SL, TP, status, exit | `{ accountId, status }`; `{ status, instrument }` for evaluation |
| `tradingLedger` | Append-only postings | Unique `{ accountId, seq }`; unique idempotency key |
| `tradingAccountEvents` | Reset and status history | `{ accountId, createdAt: -1 }` |
| `marketQuotes` | Quotes used in fills and recent cache | `{ instrument, time: -1 }`; TTL decision (D2) |

**Role:** new collections must be added to `forexorbitAppRole`, with the ledger considered for append-only access, as `adminAuditLog` is. Index scripts should follow the established pattern: read-only by default, `--apply`, duplicate checks.

**Migration:** none should be automatic. Existing `demoAccounts` balances are unreliable by construction, so they should not be carried over (D11). **How many rows exist in production is unknown.**

---

## 11. API and frontend assessment

**API**

| Route | Assessment |
|---|---|
| `POST /account` | Replace |
| `GET /account` | Replace; hides outages |
| `POST /trades` | Replace |
| `GET /trades` | Replace; returns empty lists on failure |
| `.../positions/:id/close` | Replace; add a method check |
| `GET /performance` | Replace; mock |
| `/journal*` | Keep; harden |
| `/tasks*`, `/submissions*`, `/demo-submissions/*` | Keep; fix defects |
| Prices, cancel, modify, reset, history | **Do not exist** |

**Frontend**

| Area | Assessment |
|---|---|
| `TradingInterface.tsx` | Rewrite against the new API. Remove random prices |
| Performance cards | Must not show until real |
| Order form | No sizing help, no margin preview, uses `alert()` |
| Account creation | Hidden behind `NEXT_PUBLIC_BROKER_API_ENABLED` |
| `/student-dashboard` and `/demo-trading` | Duplicate purpose (audit L3); product decision outstanding since October |
| External links to OANDA and MetaTrader | Keep or remove (D14) |
| Mobile | **Not browser-tested in this audit** |

---

## 12. Trading journal and leaderboard assessment

**Journal**
- Ownership is correct.
- It is entirely self-reported: `result` and `profitLoss` come from the student, so a claimed profit of 999,999,999 was accepted.
- Those self-reported numbers feed the instructor AI analytics as if factual (`analyze-student.ts`).
- Malformed numbers are stored as `NaN`, which reads back as null. Negative lot size was accepted, and 2 MB of notes was accepted.
- `grade` and `feedback` are shown, but nothing writes them for journal entries (P10-30).
- There is no link to executed trades. Recommended: optional `positionId`, with figures copied from the server when linked.

**Leaderboard**
- No trading leaderboard exists, so nothing leaks today. The existing leaderboard covers points, completions, quizzes and courses.
- Building one needs decisions first (D14). Raw profit rewards reckless sizing, and resets can erase losses unless they are counted.
- Recommended metric: return on starting capital within a defined period, with a minimum number of closed trades, computed from the ledger, opt-in, showing display names only.

**Metrics needing definitions:** win rate (is breakeven a loss?), return (on starting balance or per generation?), drawdown (on equity or balance?), and the treatment of open positions. The current "consistency" and "risk management" scores have no defensible definition and should be dropped until defined.

---

## 13. Findings classified P0-P4

| Level | Meaning |
|---|---|
| P0 | Feature is incorrect or unsafe at its core; blocks release |
| P1 | Serious integrity or security defect |
| P2 | Real defect with limited scope |
| P3 | Quality, coverage or performance gap |
| P4 | Minor or optional |

| ID | P | Type | Summary |
|---|---|---|---|
| P10-01 | P0 | Confirmed (OANDA response suspected) | No viable execution or isolation model |
| P10-02 | P0 | Confirmed | Displayed prices are random |
| P10-03 | P0 | Confirmed | Starting balance set by the client |
| P10-04 | P0 | Confirmed | No funds, margin or quantity validation |
| P10-05 | P0 | Confirmed | P&L and performance are mock |
| P10-06 | P0 | Confirmed | No ledger, no position or close records |
| P10-07 | P1 | Confirmed | Position close runs on GET, no CSRF |
| P10-08 | P1 | Confirmed | No idempotency |
| P10-09 | P1 | Confirmed | Duplicate accounts under concurrency |
| P10-10 | P1 | Confirmed | Floating-point money |
| P10-11 | P1 | Confirmed | Partial failures leave inconsistent records |
| P10-12 | P1 | Confirmed | Outages shown as normal data |
| P10-13 | P1 | Suspected | Demo guard is a label, not a check |
| P10-14 | P1 | Confirmed | No rate limits, including AI calls |
| P10-15 | P1 | Confirmed | Instrument not validated |
| P10-16 | P1 | Confirmed | No stale-price or market-hours handling |
| P10-17 | P2 | Confirmed | One student completes a general task for everyone |
| P10-18 | P2 | Confirmed | Students can submit to others' private tasks |
| P10-19 | P2 | Confirmed | Any instructor can analyse any student |
| P10-20 | P2 | Confirmed | Journal input unbounded and unvalidated |
| P10-21 | P2 | Confirmed | Malformed ids return 500 |
| P10-22 | P2 | Confirmed | Private responses not marked `no-store` |
| P10-23 | P2 | Confirmed | Email and broker ids stored and returned |
| P10-24 | P2 | Confirmed | Order lifecycle missing |
| P10-25 | P2 | Suspected | OANDA response mapping errors |
| P10-26 | P2 | Confirmed | Trading data orphaned on account deletion |
| P10-27 | P3 | Confirmed | No functional tests |
| P10-28 | P3 | Confirmed | Missing indexes |
| P10-29 | P3 | Confirmed | N+1 reads and notification loop |
| P10-30 | P3 | Confirmed | Journal grade and feedback have no writer |
| P10-31 | P3 | Confirmed | Duplicate practice pages |
| P10-32 | P3 | Confirmed | Super Admin excluded from task routes |
| P10-33 | P4 | Optional | Broker documents overstate the feature |
| P10-34 | P4 | Optional | `mock` broker type throws |
| P10-35 | P2 | Confirmed | Task completion changes state on GET; 7 adjacent routes have no method check (found during G0) |

### 13.1 Status after G0

Historical. Current status of every finding is in section 23.8.

| Finding | Status | Note |
|---|---|---|
| P10-02 Random prices | **Resolved** | Removed from the UI. No price is shown |
| P10-05 Mock performance | **Contained** | Route returns no figures; cards removed. Real metrics come with G6 |
| P10-07 Close on GET | **Resolved** | POST only |
| P10-22 Caching | **Partial** | `no-store` on close and performance only |
| P10-12 Outages hidden | **Partial** | Close reports broker failure honestly; `GET /account` and `GET /trades` do not |
| P10-11 Partial failures | **Partial** | A failed refresh after a close no longer reports the close as failed. No ledger yet |
| P10-35 | **Outstanding** | Documented, not expanded into G0 |
| All others | Open | Unchanged by G0 |

---

## 14. Evidence, root cause, affected files and recommended fix

### P0

**P10-01 No viable execution or isolation model.**
- *Evidence:* `createDemoAccount` stored `101-004-1234567-001_<studentId>`. The order then called `POST /v3/accounts/101-004-1234567-001_<studentId>/orders`. All students depend on one `OANDA_ACCOUNT_ID`.
- *Root cause:* a "virtual sub-account" exists only as a string; OANDA knows nothing of it.
- *Suspected:* OANDA rejects that id. If the id were corrected, all students would share one account's balance and positions, so isolation is impossible.
- *Files:* `lib/brokers/oanda-broker.ts`, `pages/api/demo-trading/account.ts`, `trades.ts`, `positions/[positionId]/close.ts`.
- *Fix:* server-side simulator; the provider supplies prices only (D1).

**P10-02 Random prices.**
- *Evidence:* `components/TradingInterface.tsx:84-98` generates `1.0 + Math.random() * 0.1`, with a comment that it would call an API. No price route exists.
- *Impact:* students see invented values beside an order form, with no label saying so.
- *Fix:* server price endpoint with timestamps; hide prices when unavailable.

**P10-03 Client-set balance.**
- *Evidence:* `initialBalance` of `1e15`, `-500` and `"lots"` each returned 201 and were stored as given.
- *Root cause:* `const balance = initialBalance || 10000`.
- *Files:* `account.ts`, `oanda-broker.ts`.
- *Fix:* server-configured balance; ignore the client (D5).

**P10-04 No funds, margin or quantity validation.**
- *Evidence:* units of `-5`, `"abc"` (`NaN`) and `1e12`, and a text stop-loss, all returned 201 and reached the broker. `-5` with `side: buy` would reverse the direction.
- *Fix:* validated order service with instrument rules and a margin check (D3, D6).

**P10-05 Mock P&L and performance.**
- *Evidence:* buy at 1.1000 and sell at 1.2000 gave 0 wins, 0 losses, net 0. `lib/performance-metrics.ts:24-27` comments "mock P/L calculation".
- *Impact:* the page presents zeros as performance.
- *Fix:* derive from closed positions and the ledger. Remove the cards until then.

**P10-06 No ledger or close records.**
- *Evidence:* `close.ts` writes nothing about the trade. `demoTrades` rows are never updated.
- *Impact:* nothing is reproducible, reconcilable or auditable.
- *Fix:* append-only ledger and position records.

### P1

**P10-07 Close on GET.**
- *Evidence:* a GET with only a session cookie, no Origin or CSRF header, reached `broker.closePosition`. (The probe's 500 came afterwards, from a deliberately failing fake broker.)
- *Root cause:* no method check in `close.ts`; CSRF applies to unsafe methods only. A `SameSite=Lax` cookie is sent on top-level GET navigation.
- *Fix:* POST only. Quick and independent of all decisions, but only matters while the route stays.

**P10-08 No idempotency.** Evidence: the same request twice gave 2 broker orders and 2 rows; `clientOrderId` is ignored. Files: `trades.ts`. Fix: unique client key.

**P10-09 Duplicate accounts.** Evidence: 4 parallel creates gave 4 rows; no unique index. Root cause: check-then-insert. Fix: unique index plus duplicate handling.

**P10-10 Floating-point money.** Evidence: section 6. Files: all listed routes, `oanda-broker.ts`, `performance-metrics.ts`, `TradingInterface.tsx`. Fix: section 6.

**P10-11 Partial failures.** Evidence (code): `placeOrder` makes a broker call, an insert, then an update, with no recovery; the close route likewise. Fix: recoverable workflow.

**P10-12 Outages hidden.** Evidence: with the broker down, `GET /account` returned 200 with the stored balance and no stale marker; `GET /trades` returned 200 with empty positions. A student would believe they hold no positions. Files: `account.ts`, `trades.ts`. Fix: return an explicit unavailable state.

**P10-13 Demo guard is a label (Suspected).** Evidence: `OandaBroker` passes `isDemo: true` as a constant, so the checks in `BaseBroker` cannot fail, while `OANDA_DEMO_URL` comes from the environment. A live URL and a live key would pass every guard. Requires a misconfiguration. The roadmap and this phase forbid real execution. Fix: removing broker execution removes this risk entirely (D1).

**P10-14 No rate limits.** Evidence: no limiter in `pages/api/demo-trading/*`, or in `pages/api/ai/analyze-trade.ts`. Each journal POST can trigger a paid AI call. Fix: existing limiters.

**P10-15 Instrument not validated.** Evidence: `NOT_A_PAIR` and an object `{ $ne: 1 }` both reached the broker and returned 201. Fix: server allowlist (D3).

**P10-16 No stale-price or market-hours logic.** Evidence: no such code exists. Fix: section 7, D9.

### P2

**P10-17 Shared completion.** Evidence: student A completed a general task, then student B got 400 "Task is already completed". Root cause: `completed` lives on the shared `demoTasks` document. File: `tasks/[id]/complete.ts`. Fix: per-student completion record.

**P10-18 Cross-student submission.** Evidence: student B submitted to a task assigned only to A (200). File: `tasks/[id]/submit.ts`. Fix: the same assignment check the complete route uses.

**P10-19 Instructor scope.** Evidence (code): `analyze-student.ts` takes any `studentId` from the body and reads that student's journal and submissions, with no course or task relationship check. Requires AI to be configured. Fix: scope to the instructor's students (needs a definition of that link).

**P10-20 Journal input.** Evidence: `entryPrice: 'abc'` stored as `NaN`, lot size `-9`, a 2 MB note, and `profitLoss` 999,999,999 all returned 201. Fix: validation and limits; label self-reported values.

**P10-21 Malformed ids.** Evidence: `not-an-id` on task complete and a malformed `taskId` on the journal returned 500 from a `BSONError`. Fix: validate with `isStoredId` first.

**P10-22 Caching.** Evidence: the account response had no `Cache-Control`. Fix: `setPrivateNoStore`.

**P10-23 Exposure.** Evidence: the response includes `brokerAccountId`, which contains the platform's OANDA account id, and `accountName` containing the student's email (their own). Fix: a presenter with safe fields.

**P10-24 Order lifecycle.** Evidence: `cancelOrder` has no route; stored status never changes; no expiry; stops cannot be modified. Fix: lifecycle in the order service.

**P10-25 OANDA mapping (Suspected).** Evidence (code, against a recollection of OANDA's API): `positionId: pos.id` may be undefined because positions appear keyed by instrument; `pos.long?.units || pos.short?.units` returns `"0"` for shorts if both sides are present; transaction type filters may not match real values. Not tested against OANDA. Becomes moot if broker execution is removed. If OANDA stays as price source, only pricing matters.

**P10-26 Orphaned data.** Evidence: `deleteAccount` removes the user and sessions only; `docs/audits/phase-1-3-remediation.md` lists these collections as linked. `accountName` keeps the email after deletion. Fix: a retention decision (section 15), then a cascade or anonymization.

### P3 and P4

**P10-27 Tests.** Only `tests/batch-lookup.test.js` and `tests/learning-indexes.test.js` touch this area, at source or index level. No test exercises account, order, close, performance or broker behaviour.

**P10-28 Indexes.** None on `demoAccounts`, `demoTrades`, `demoTasks` or `demoTaskSubmissions`.

**P10-29 N+1.** `submissions.ts`, `tasks/[id]/submissions.ts` and `submissions/student.ts` read per row. Creating a general task sends notifications to every student one by one.

**P10-30 Dead fields.** Journal `grade`, `feedback` and `reviewedAt` are shown, but no route writes them. Review writes to submissions.

**P10-31 Duplicate pages.** `/student-dashboard` and `/demo-trading` overlap. Open since the October audits.

**P10-32 Super Admin.** Task routes allow `instructor` and `admin` only. Recorded as existing role policy in `docs/audits/phase-1-3-remediation.md`.

**P10-33 Documents.** `README_BROKER_INTEGRATION.md` and `BROKER_API_SETUP.md` describe working broker trading.

**P10-34 Mock broker.** `BROKER_TYPE=mock` throws. Superseded by the proposed `PriceSource`.

**P10-35 State change on GET, adjacent routes (found during G0).**
- *Evidence:* a GET to `tasks/:id/complete` with only a session cookie returned 200 and set `completed: true`. It is the same class as P10-07, with lower impact because it marks a task rather than moving a position.
- *Also:* these routes have no method check: `tasks/[id]/complete`, `tasks/[id]/submit` (a GET returned 500), `tasks/[id]/submissions`, `submissions.ts`, `submissions/student.ts`, `journal/upload.ts` and `demo-submissions/[id]/review.ts`. The read-only ones are harmless; the writing ones should be limited to their method.
- *Fix:* method checks, in G8. Left out of G0 as instructed: document rather than expand.

---

## 15. Product decisions requiring approval

Superseded: the owner has since decided all of these. See section 23.2. D1 and D2 are recorded in section 15.1.

### 15.1 Approved decisions (owner, 4 November 2026)

**D1, execution model: approved.** Build an internal, server-side virtual trading simulator. ForexOrbit Academy owns account balances, orders, execution, positions, P&L, margin and trade history. External providers may supply market prices only. No real-money trading or broker order execution.

**D2, market data: approved.** Begin with recorded, timestamped historical market data. Data must be reproducible, and its source, licensing, redistribution rights and permitted educational use must be verified before adoption. No random, invented or unverified prices. Live market data can be considered later, following a licensing and cost review.

### 15.2 All decisions

| ID | Decision | Recommended default | Why | Alternatives and consequences |
|---|---|---|---|---|
| **D1 (APPROVED)** | Execution model | **Internal simulator**; provider gives prices only | Only way to get isolation, reproducibility and virtual balances | Per-student broker accounts: not available programmatically as far as known, heavy. Keep manual-only journal: removes the feature and misses the roadmap |
| **D2 (APPROVED)** | Market-data source | **Recorded feed first, behind an interface**; live provider after license review | Unblocks work, deterministic tests, no commitment | Decide now: faster to live, but licensing unverified |
| **D3** | Instruments | The 6 existing pairs: EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF | Already in the UI, all have USD | More pairs need cross conversion |
| **D4** | Accounts per student | **One active account** | Simple, fair, matches intent | Several: more complexity, and easier to game a leaderboard |
| **D5** | Starting balance and currency | **USD 10,000**, server config | Existing default in code and UI | Student-chosen: undermines comparison |
| **D6** | Leverage and size limits | **Fixed 1:30**, minimum 1,000 units, maximum set by margin | Teaches caution; 1:30 is a common retail cap | Selectable leverage: more realistic, riskier habits. Higher leverage: larger losses, less instructive |
| **D7** | Order types | **Market, limit, stop, plus SL and TP**; partial close later | Roadmap "where supported", UI offers all three | Market only first: faster delivery |
| **D8** | Execution and slippage | **Fill at current bid or ask, no added slippage**; on gaps, fill at the first available price; SL wins if both are crossed | Reproducible and conservative | Simulated slippage: realistic, harder to explain |
| **D9** | Sessions and weekends | **Closed Friday 22:00 to Sunday 22:00 UTC**; no fills; positions stay open | Matches the usual forex week | Always open on recorded data: not realistic. Exact hours need confirmation |
| **D10** | Fees and spread | **Provider spread only, no commission** | One visible cost | Fixed spread: works without bid/ask, less real |
| **D11** | Reset and legacy data | **Reset allowed once per 30 days, only with no open positions; history kept and counted**; old `demoAccounts` not migrated | Stops erasing bad results | Free resets: no integrity. No reset: students can get stuck after losses |
| **D12** | Consistency approach | **Recoverable workflow** | Matches Phases 5-9; works everywhere | Transactions: confirm Atlas topology, change local Mongo |
| **D13** | Rounding and storage | **BigInt fixed-point, Decimal128, half-even, 2 decimals at ledger posting** | No dependency, exact | `decimal.js`: adds a dependency |
| **D14** | Leaderboard, journals, access | **Leaderboard opt-in, return-based, from the ledger, deferred to the last group; journals private**, visible to staff only through tasks; desk open to all approved students; keep external links as optional | Protects privacy, avoids rewarding reckless sizing | Raw profit ranking: misleading. Shared journals: needs consent and moderation. Enrollment-gated desk: changes current access |

**Also needed:** what happens to trading data when an account is deleted (P10-26), stop-out behaviour (recommended: close the largest loser when margin level falls below 50%, or simply block new orders first) and whether AI analysis may read simulator results.

---

## 16. Dependencies and regression risks

| Area | Link to trading | Risk |
|---|---|---|
| Authentication, sessions | `withAuth` on all routes | Low: reused unchanged |
| Roles, account lifecycle | Suspended accounts blocked by `withAuth` | Low; deletion needs D11 |
| Phase 6 enrollment | **None**: the desk is not tied to enrollment | Low unless D14 changes that |
| Phase 7 lesson delivery | None | Low |
| Phase 8 progress | None; `learningMinutes` not used here | Low |
| Phase 9 assessments | Shared leaderboard page; assignment points unrelated | Low; a new tab must not disturb the rules text |
| `lib/app-database-role.js` | New collections | Must update, or writes fail in production (same class as P9-14) |
| `server.js` | New background job | Medium: failure must not affect the server |
| Instructor AI | Reads journal | Medium if the journal model changes |
| `pages/student-dashboard.tsx` | Shares guide and journal | Medium: keep its reads working |

**Release stacking risk:** `origin/master` is `0935557`, so Phases 7, 8 and 9 are unreleased, each with database prerequisites. Adding Phase 10 grows the batch further. **Consider releasing 7-9 first.** This is the owner's call and was not assumed.

---

## 17. Prioritized implementation plan

| Group | Content | Depends on |
|---|---|---|
| **G0 Containment (DONE, 17.1)** | Remove random prices; hide mock performance; POST-only close; label the desk truthfully | Nothing |
| **G1 Money core** | Pure fixed-point library, formulas, instrument table | D3, D13 |
| **G2 Market data** | `PriceSource`, recorded feed, freshness, session calendar, price API | D2, D9 |
| **G3 Accounts and ledger** | Accounts, ledger, unique indexes, reconciliation, role | D4, D5, D12 |
| **G4 Market orders and positions** | Validation, idempotency, execution, open, close | G1-G3, D6, D8, D10 |
| **G5 SL, TP, pending orders** | Evaluator job, cancel, expiry, stop-out | G4, D7 |
| **G6 Reset and history** | Reset, history, performance from the ledger | G4, D11 |
| **G7 Frontend** | New trading UI, mobile | G2-G6 |
| **G8 Desk fixes** | P10-17 to P10-22, P10-26, P10-29, P10-30, P10-35 | Independent |
| **G9 Leaderboard** | Trading rankings | G6, D14 |
| **G10 Close-out** | Live provider, retire old routes, report | D2 |

---

### 17.1 G0 containment record

**Scope authorized:** G0 only, on this branch. No engine, ledger, financial calculation or market data was built.

**Changes**
- **Random prices removed.** `TradingInterface` no longer generates or shows prices, and the 5-second refresh is gone. The pair list shows names only.
- **Mock performance switched off.** The cards are removed and the UI no longer requests the route. `GET /api/demo-trading/performance` returns `503 performance_unavailable` with no figures and no broker call. `lib/performance-metrics.ts` is kept, as files are not being deleted, but it is imported by nothing and marked NOT IN USE. A test guards that.
- **Truthful notice added:** "Prices and performance results are not shown here yet."
- **Position close hardened.** POST only (405 with `Allow: POST` otherwise). The id is validated. The account must be the session's own, must be demo, and its broker id must carry the student's suffix, so the shared platform account is refused. The position must be listed on that account before any close is sent. Failures are fixed 503 messages, and an uncertain close says so instead of claiming nothing happened. A failed balance refresh no longer reports a completed close as failed. Responses are `no-store`.

**Files**
- Changed: `components/TradingInterface.tsx`, `lib/performance-metrics.ts` (comment only), `package.json`, `pages/api/demo-trading/performance.ts`, `pages/api/demo-trading/positions/[positionId]/close.ts`.
- New: `lib/practice-position-close.js` and `.d.ts`, `tests/phase-10-practice-trading.test.js`, `scripts/acceptance/trading-e2e.js`.

**Verification**

| Check | Result |
|---|---|
| New suite before the route fix | **6 of 17 failed**, including `200 !== 405` on the GET close |
| `npm run test:trading` | **17/17** |
| `npm test` | **956/956**, also with the clock 30 days ahead |
| `node scripts/acceptance/trading-e2e.js` | **15/15** on the real server and Edge, including 390 px |
| Mutation check | 7 safeguards removed in memory, all caught |
| TypeScript | 0 errors |
| ESLint, whole repository | 0 errors, 669 warnings (674 at `be477d6`; G0 removed 5 net) |
| Production build | Passes |
| Secret scan, whitespace | Clean |

**Not rerun:** the Phase 6-9 browser suites and real-MongoDB suites, because G0 touches none of their code paths. The full unit suite was rerun.

**No broker API was called.** Unit tests use a fake broker that records calls. The browser run had no broker key, so the broker could not be constructed; the safe 503 on a real POST confirms that.

**Remaining mock and broker paths (deliberately unchanged, replaced by later groups)**

| Path | State | Replaced by |
|---|---|---|
| `POST /account` | Client-set balance, invented broker id (P10-01, P10-03) | G3 |
| Balance, margin and open-trade cards | **Still shown.** They display that stored, unverified balance | G3, G7 |
| `POST /trades` and order form | Still forwards orders if a broker is configured, unvalidated (P10-04, P10-08, P10-15) | G4 |
| `GET /trades` | Hides outages as empty lists (P10-12); positions and history are broker-derived | G4 |
| `GET /account` | Falls back silently to the stored balance (P10-12) | G3 |
| Position close | Safe, but still broker-based and unrecorded (P10-06) | G4 |
| `lib/brokers/*` | Retained. D1 means broker execution is removed in G10 | G10 |
| `lib/performance-metrics.ts` | Unused, retained | G6 or G10 |

The broker path needs `NEXT_PUBLIC_BROKER_API_ENABLED` for the create button, and server broker variables to do anything. Whether these are set in production is still unverified (section 21).

---

## 18. Acceptance criteria for each implementation group

| Group | Accepted when |
|---|---|
| G0 | **Met.** No random price is shown; performance cards are removed; GET close returns 405 |
| G1 | Golden-value tests pass; 100,000 postings produce no drift; JPY precision is correct; no `parseFloat` in money paths |
| G2 | Stale, missing, crossed (ask below bid) and closed-market quotes are refused with a reason; replaying recorded data gives identical results |
| G3 | One active account per student under concurrency; client balance is ignored; ledger sum equals balance after any failure |
| G4 | Concurrent orders cannot exceed funds; a retry returns the same order; concurrent closes give one result; P&L matches hand-calculated examples; failure at each step recovers exactly once |
| G5 | SL and TP fire once; both-crossed follows D8; pending orders fill once; restart recovers; evaluator failure does not affect the server |
| G6 | Reset respects D11, races are safe, history survives, metrics reconcile with the ledger |
| G7 | Every number comes from the server; no misleading success state; passes at 390 px and desktop |
| G8 | Each finding has a regression test |
| G9 | Only eligible, opted-in accounts appear; no private data; resets cannot improve rank |
| G10 | Old routes retired or redirected; full gates pass; report complete |

---

## 19. Unit, integration, real-Mongo and browser test plan

**Current coverage:** G0 added `tests/phase-10-practice-trading.test.js` (17) and `scripts/acceptance/trading-e2e.js` (15) for close, performance and price removal. Order, account, position and P&L behaviour has none yet (P10-27).

| Scenario from the brief | Unit | Route | Real Mongo | Browser |
|---|---|---|---|---|
| Invalid quantities, prices, leverage, instruments | Yes | Yes | | |
| Insufficient funds | Yes | Yes | Yes | Yes |
| Unauthorized access, cross-user IDOR | | Yes | | Yes |
| Concurrent order placement | | | **Yes** | |
| Duplicate requests, retry recovery | | Yes | **Yes** | Yes |
| Deterministic P&L | Yes (golden values) | | | |
| Decimal precision, rounding | Yes | | | |
| Stale or missing prices | Yes | Yes | | Yes |
| Market availability | Yes | Yes | | Yes |
| SL and TP | Yes | | **Yes** | Yes |
| Pending-order execution | Yes | | **Yes** | Yes |
| Position close, concurrent close | | Yes | **Yes** | Yes |
| Reset and history | | Yes | **Yes** | Yes |
| Database failures during execution | | Yes (injection) | **Yes** (injection) | |
| Reconciliation | Yes | | **Yes** | |

**Suites:** extend `tests/phase-10-practice-trading.test.js` and `scripts/acceptance/trading-e2e.js`, and add `tests/integration/trading-phase10-mongo.test.js`, using the existing harness, helpers and guards.

**Also required:** a recorded feed for determinism, mutation checks on key safeguards, and Phase 6-9 regression suites. The in-memory helper does not simulate Decimal128, so **money tests must run on real MongoDB**.

---

## 20. Rollout and rollback considerations

**Rollout (draft)**
1. Read-only inventory of production: `demoAccounts`, `demoTrades` counts, and whether broker variables are set.
2. Release order for Phases 7-9 agreed first.
3. Update the role before deploying.
4. Build indexes with read-only checks first.
5. Add new environment variables only after the provider decision.
6. Deploy behind a server-side flag, off by default.
7. Enable for staff, then students.

**Rollback:** turn off the flag. New collections are additive and ignored by old code. Old `demoAccounts` stay untouched, which keeps rollback simple. A running evaluator must stop cleanly.

**Operational:** a price outage blocks new fills by design and needs a visible status. Provider quota needs monitoring. If production ever runs several instances, the evaluator must stay safe, which conditional updates provide.

---

## 21. Known limitations and items requiring external verification

**Limits of this audit**
- The audit itself had no browser run, so frontend findings came from code. G0 later verified the practice tab in Edge, including 390 px; the rest of the desk on mobile is not assessed.
- OANDA was not called. P10-01's rejection and P10-25 are unverified.
- Probes used an in-memory database, so races show logic gaps rather than real timing. P10-09 is a logic gap regardless, because no unique index exists.
- Screenshot upload and AI flows were read, not run.

**Must be verified externally**
1. Production: are `OANDA_*`, `BROKER_*` and `NEXT_PUBLIC_BROKER_API_ENABLED` set? How many `demoAccounts` rows exist?
2. Atlas topology and tier.
3. Render plan and instance count, in the dashboard.
4. OANDA API license terms for multi-user display (the search did not find them).
5. Pricing, delay, bid/ask availability and redistribution terms for any provider. The figures in section 7 came from third-party blogs and conflict.
6. Exact forex session times for D9.
7. Whether financial-promotion or simulated-trading rules apply in the markets served. This is a legal question, not an engineering one.

**Sources for section 7 (third-party and partly promotional; verify before use)**
- [Twelve Data alternatives (FCS API)](https://fcsapi.com/blog/twelve-data-alternatives)
- [12 Best Financial Market APIs in 2026 (APILayer)](https://blog.apilayer.com/analyzing-the-top-free-apis-for-stock-data/)
- [Best real-time forex API 2026 (AllRatesToday)](https://allratestoday.com/blog/best-realtime-forex-api-2026.md)
- [Top market data APIs in 2026](https://eqv.uk.com/blog/top-5-market-data-apis-in-2026)
- [OANDA v20 getting started](https://developer.oanda.com/rest-live-v20/introduction/)
- [OANDA pricing endpoints, third-party wrapper documentation](https://oanda-api-v20.readthedocs.io/en/master/endpoints/pricing.html)

---

## 22. Recommended first implementation task

Historical: G0-G10 are complete. See section 23.

**G0 is done. Next: G1, the money core, once D3 and D13 are approved.** It is a pure library with golden-value tests, it has no database or provider dependency, and every later group depends on it. D1 is already approved.

The recorded dataset for G2 needs its own verification under D2 before adoption, so that work can run alongside G1.

---

## 23. Completion record (G1-G10)

Sections 1-22 record the audit as written. This section records what was built afterwards and takes precedence where they differ.

**Result:** the simulator is built and verified on TEST-ONLY quotes. **It cannot trade for students yet, because no market-data source could be approved (section 23.4).** With no approved dataset it stays suspended, shows no price and fills nothing. All work is uncommitted on `feat/phase-10-practice-trading`, based on `be477d6`.

| Group | Delivered | Status |
|---|---|---|
| G0 | Containment | Done (section 17.1), later superseded by the simulator |
| G1 | Exact money core: `lib/trading/money.js`, `instruments.js` | Done |
| G2 | Market-data boundary, approval gate, replay clock, calendar, import: `market-data.js`, `calendar.js`, `import.js` | Done. **No approved data** |
| G3 | Accounts, slot, reset: `engine.js` | Done |
| G4 | Orders, fills, closes, SL, TP, pending, expiry, margin call, stop-out | Done |
| G5 | Student API `pages/api/trading/*`; broker routes retired with 410 | Done |
| G6 | Recovery, reconciliation, evaluator job, indexes, scripts | Done |
| G7 | Student desk: `components/TradingInterface.tsx` | Done |
| G8 | Tasks, journal, submissions, AI scope and limits | Done |
| G9 | Opt-in leaderboard | Done |
| G10 | Verification and this record | Done (section 23.7) |

### 23.1 Defects found by verification

These were real defects in the new code, each fixed and covered by a test:

| Found by | Defect | Fix |
|---|---|---|
| Concurrency test | Concurrent orders could spend the same margin, because rules read positions while a fill was applied but its position was unwritten | `settleApplied` runs before rule checks |
| Failure injection | A crash could leave a stale `applied` marker | Finish order changed; recovery detects finished work from position state |
| Failure injection | An abandoned reset blocked all future resets | The reset operation id includes the account version |
| Repeated real-MongoDB runs | **Aggregate risk could exceed 5%** (4 positions where 3 fit, about one run in four): `settleApplied` could return an account holding a newly applied operation | It repeats until nothing is outstanding; the test now runs 12 rounds |
| Browser suite | A wrong-side stop showed "The order could not be executed." | Own explanation for `invalid_stop_loss`, `invalid_take_profit`, `invalid_order_price`; a test now requires one for every such code |
| Mutation check | Nothing pinned the margin call at exactly 100.00% | Boundary test |
| Browser suite | `GET` trading routes had no rate limit, although reads run the evaluator | `tradingReadLimiter`, 1,200 per 10 minutes per student |

### 23.2 Decision register

Decisions 1-14 are the owner's, adopted 4 November 2026. They replace the recommendations in section 15.2.

| # | Decision | Where enforced |
|---|---|---|
| 1 | Internal server-side simulator only | `lib/trading/`; broker routes answer 410; `lib/brokers/` is unimported |
| 2 | Verified, timestamped historical data; no random, invented or unverified prices | `datasetProblems` gate; suspended without an approved dataset |
| 3 | Six existing pairs, subject to coverage and licensing | `INSTRUMENTS` |
| 4 | One active account per student | `tradingAccountSlots`, `_id` = user id |
| 5 | USD 10,000 virtual, set on the server | `STARTING_BALANCE`; the client sends no amount |
| 6 | Leverage 1:30, minimum 1,000 units | `LEVERAGE`, `MIN_UNITS` |
| 7 | Market, limit and stop orders with SL and TP | `placeOrder`, `evaluateAccount` |
| 8 | Historical bid and ask, spread-aware, reproducible, no invented slippage, simplified model disclosed | `entryPriceOf`, `exitPriceOf`, `simulator-disclosure` |
| 9 | Accurate calendar including weekends, holidays and DST | `calendar.js`, New York wall clock |
| 10 | Spread only; no commission or swap; disclosed | No fee code exists; disclosure text |
| 11 | One reset per 30 days; old account and history kept | `resetAccount`, `RESET_INTERVAL_MS` |
| 12 | Recoverable operations, idempotency, reconciliation, duplicate prevention | `tradingOperations`, `recoverOperations`, `reconcileAccount` |
| 13 | Exact decimal, half-even, no floats for authoritative values | BigInt, Decimal128, strings over JSON |
| 14 | Leaderboard opt-in, pseudonymous, percentage return with drawdown; journals and account details private | `views.js` |

Additional owner rules: margin call at 100%, stop-out at 50%, at most 2% planned risk per trade and 5% aggregate, server-generated ids, students reach only their own records, pending orders expire or can be cancelled, missing data means safe rejection or suspension, the ledger is never rewritten, every balance is labelled virtual.

**Engineering choices needed to apply those rules, for the owner to note:**

| Choice | Why |
|---|---|
| A stop-loss is mandatory on every order | "Planned risk" cannot be computed without one |
| Pending orders count toward the 5% aggregate | Otherwise resting orders could exceed it together |
| Reset requires no open positions | Open risk cannot be abandoned by resetting |
| Maximum 10,000,000 units; 50 open positions and pending orders; expiry 1-168 hours, default 24 | Bounds on work and abuse |
| Leaderboard: at least 5 closed trades; return measured on all virtual capital across resets | A reset cannot improve a rank |
| Stop-out closes the largest loser first, repeating until the level recovers | Audit recommendation, section 15 |
| No partial close | Not required by the decisions |

### 23.3 Financial formulas and execution model

All values are integers. Prices have scale 5, money scale 2, percentages scale 2. Each result is rounded once, half-even. JPY prices have 3 decimals; other pairs 5.

| Quantity | Formula |
|---|---|
| Notional, USD | `units` when USD is the base; otherwise `units x price` |
| Required margin | `notional / 30` |
| Profit or loss | Buy: `(exit - entry) x units`. Sell: `(entry - exit) x units`. If USD is the quote this is USD; if USD is the base it is divided by the exit price |
| Planned risk | The loss if the stop-loss is hit, at the entry and stop prices |
| Equity | `balance + unrealized P&L` |
| Free margin | `equity - used margin` |
| Margin level | `equity / used margin x 100`; none with no open position |
| Return | `net result / starting capital of all generations x 100` |

Worked example, checked in the browser: buy 10,000 EUR/USD at 1.10020 with the bid at 1.10000. Margin is 11,002.00 / 30 = 366.73. Open P&L is -2.00. Equity is 9,998.00, free margin 9,631.27, margin level 2,726.26%.

**Execution**
- A buy opens at the ask and exits at the bid. A sell opens at the bid and exits at the ask.
- Market orders fill at the latest valid recorded quote.
- Limit and stop orders fill when the entry side reaches the price, at the recorded quote. Past a gap that is the quote, not the requested price.
- A long's SL and TP watch the bid; a short's watch the ask. A gap fills at the recorded quote, so a loss can exceed planned risk. If both would trigger on one quote, the stop-loss wins.
- The evaluator walks every recorded quote since `evaluatedThrough`, in time order, so a run is reproducible.
- New orders are refused at or below 100% margin level. At or below 50%, positions are stopped out.
- Replay runs at real speed: `simulated time = startAt + (now - replayAnchorAt)`. When the data ends, the desk suspends.
- A trading day is the New York wall clock plus 7 hours, so the week follows DST. Saturday and Sunday trading days are closed, as are 25 December and 1 January.

**Stop-out reachability:** because every position has a stop, a stop-out needs a gap past stops. It was tested by widening stops directly in the database.

### 23.4 Market-data source and licensing assessment

**Outcome: blocked. No source can be approved from public terms.** Pages were read without creating any account. Nothing was downloaded, purchased or stored.

| Source | What its pages say | Bid and ask | Verdict |
|---|---|---|---|
| [Dukascopy](https://www.dukascopy.com/swiss/english/legal-pages/terms-of-use/) | Terms sections 3-4: "solely for your own non-commercial use"; no database; no redistribution | Yes | **Not permitted** without a written agreement |
| [HistData](https://www.histdata.com/f-a-q/) | No licence text found; the terms link returned 404; FAQ gives no warranty; EST without DST; ask only in tick data | Partial | **Rights unknown** |
| [TrueFX](https://www.truefx.com/truefx-historical-downloads/) (Integral) | Terms link returned 404; downloads need a login | Reportedly | **Terms unreadable** |
| [OANDA](https://developer.oanda.com/rest-live-v20/introduction/) | API licence is behind a login; terms link returned 404 | Yes | **Unknown** |
| [ECB](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html) | Free use with citation | **No**: one reference rate | Rights fine, data unusable under decision 8 |
| [Federal Reserve](https://www.federalreserve.gov/disclaimer.htm) | Board information public domain, with citation | **No**: noon rates | Rights fine, data unusable under decision 8 |

**Why the free reference rates are not a workaround:** a spread added to a mid rate would be an invented price.

**What the owner needs to obtain:** written rights to store and display historical bid and ask quotes to registered users of a commercial education site, covering the six pairs. Options, none yet taken: read OANDA's licence from an account, read TrueFX's terms after registering, ask Dukascopy for a written agreement, or buy licensed data.

**Then, for a dataset:** complete the manifest (`REQUIRED_APPROVAL_FIELDS`: source, URL, retrieval date, licence name and URL, educational use, storage and redistribution rights, timezone, DST, approver, date), run `scripts/market-data-import.js` without and then with `--apply`, and activate it as a separate approved production change. Still to measure on real data: quote density, gaps and whether the 120-second default age limit and 100-pip spread limit suit it.

### 23.5 Security and privacy assessment

| Control | Implementation | Evidence |
|---|---|---|
| Authentication | `withAuth` on every route | Live 401/403 |
| CSRF | Origin and `X-FO-CSRF` on unsafe methods | Live: missing header and foreign Origin both 403 |
| Authorisation | Student role only; instructors and admins get 403 | Live |
| Object ownership | Every lookup includes `userId`; another student's id answers 404 | Live: close, modify, cancel, ledger read |
| Input | Whitelisted fields; amounts must be strings; objects and JSON numbers refused | Live and unit |
| Client-set money | No route accepts a balance, price or fill | Unit; order input has no such field |
| State change on GET | Closed: 405 with `Allow` | Live |
| Rate limits | 300 writes and 1,200 reads per 10 minutes per student; AI analysis limited | Live: 429 at request 301 and 1,201 |
| Caching | `no-store` on every trading response | Live |
| Errors | Safe messages, no internals | Unit |
| Ledger integrity | App role has `find` and `insert` only on `tradingLedger` | `tests/app-database-role.test.js` |
| Real-money isolation | No broker code is imported; no provider credential | Browser and log checks |
| Fixture safety | `testFixture` datasets refused when `NODE_ENV=production` | Unit and mutation |

**Privacy:** the leaderboard returns a random `Trader-XXXXXX` alias, return, drawdown, trade count and whether the row is yours. Live checks confirm it has no name, email, id or balance, and opting out removes the row. Journals stay private to the student, and staff see them only through tasks. Instructor AI analysis is limited to students they teach. Trading records hold a user id and no name or email; the old `accountName` email is not carried forward.

**Retention (P10-26):** an admin deleting a user does not delete `trading*` rows. This is left as is, because the ledger is append-only and the app role cannot remove from it. The remaining rows hold an id only. Whether they must be purged is a retention policy decision for the owner.

### 23.6 Data model and rollout objects

**Collections:** `tradingAccountSlots`, `tradingAccounts`, `tradingOperations`, `tradingOrders`, `tradingPositions`, `tradingLedger` (append-only), `marketDataSets`, `marketQuotes`.

**Indexes** (`scripts/trading-indexes.js`, read-only without `--apply`): T1, T2 positions; T3, T4 orders; T5 operations; T6 ledger `{accountId, seq}` unique; T7 ledger; T8 quotes `{datasetId, instrument, time}` unique; T9 accounts; T10 slots. Correctness does not depend on them except T6 and T8 as added protection: one active account comes from the slot document and duplicates from deterministic ids.

**Role:** `lib/app-database-role.js` adds the collections above, with `tradingLedger` append-only. `marketDataSets` and `marketQuotes` are read-write only because the role is per collection and the app reads them; the app never writes them.

**Environment:** one optional variable, `TRADING_EVALUATOR_INTERVAL_SECONDS` (default 15, minimum 5, 0 off). `OANDA_*` and `BROKER_*` are no longer used.

**Old data:** `demoAccounts` and `demoTrades` are neither migrated nor deleted.

### 23.7 Test and verification evidence

Run on 4 November 2026, Windows 11, Node, local MongoDB 9.0.4 (standalone), headless Microsoft Edge. Final results, after the last code change unless marked:

| Gate | Result |
|---|---|
| `npm test` | **1,026 of 1,026 passed**, 0 failed, 0 skipped |
| `npm test` with the clock 30 days ahead | **1,026 of 1,026 passed** |
| `npm run test:trading` (part of the above) | 87 of 87 passed |
| `npm run test:mongo:trading` | **26 of 26 passed**, and 10 consecutive full runs after the race fix |
| `npm run test:mongo:assessments` | 32 of 32 passed |
| `npm run test:mongo:payments`, `:enrollment`, `:progress` | 4 of 4, 3 of 3, 3 of 3 passed (before the last engine fix, which they do not load) |
| `npm run test:mongo` (rate limits) | **Flaky, existing: see below.** 11 of 12 in the gate run; 12 of 12 in 5 of 6 comparison runs |
| Trading browser suite | **88 of 88 passed** |
| Learning, enrollment, progress and assessment browser suites | 73 of 73, 42 of 42, 30 of 30, 80 of 80 passed (before the last engine fix, which they do not exercise) |
| Mutation check | 22 of 22 caught, after one survivor led to a new boundary test |
| `tsc` | Clean |
| `next build` | Succeeds |
| `next lint` | 0 errors, 780 warnings, up from 674 at `be477d6`. Most of the rise is the `any` declarations in generated `lib/trading/*.d.ts`, the pattern other `.d.ts` files already use. Not reviewed one by one |
| Secret scan and `git diff --check` | Nothing found; only line-ending notices remain |

**The rate-limit flake.** `tests/integration/rate-limit-mongo.test.js` tests 7 and 11 fail intermittently. Six alternating runs: **unchanged Phase 9 (`be477d6`) failed 5 of 6, Phase 10 failed 1 of 6**, so Phase 10 did not cause it. The test 11 failure examined allowed 8 attempts against an expected 10, which is too few rather than too many. This is the known P9-29 behaviour and remains unfixed.

**Requirement coverage**

| Requirement | Evidence |
|---|---|
| Exact decimal, rounding, precision, pip values, sizing | Unit golden values; mutants on half-even and margin caught |
| Spread and bid/ask execution | Unit, browser; side-swap mutants caught |
| Balance, equity, margins, margin level, P&L | Unit, real MongoDB, browser figures worked by hand |
| Margin and risk rejection | Unit, 30- and 40-way races on real MongoDB, browser alerts |
| SL, TP, pending, expiry | Unit, real evaluator job in the browser run |
| Closures and unavailable data | Unit including DST; browser: weekend, Christmas, stale, crossed quote, no dataset |
| Concurrent creation and orders | Real MongoDB, 12 parallel creates over HTTP |
| Idempotency | 30 identical requests; a response dropped by the browser after the server acted, then retried |
| Interruption and recovery | 11 injected failure points on real MongoDB |
| Reset limits and history | Unit, real MongoDB race, browser |
| Cross-student access, instructor permissions | Live HTTP |
| CSRF, auth, validation, rate limiting | Live HTTP |
| Learning, assessment and instructor regression | Unit, Mongo and four browser suites |
| Responsive behaviour, accessible errors | 390 px with strict width, 44 px buttons, labels, `role="alert"` |

**Not used as evidence:** mocked financial results. Figures were worked out by hand from fixture quotes and asserted through the real engine and real MongoDB.

**Test changes to disclose:**
- G0's broker-based ownership tests were replaced by simulator route tests and a retired-route test with a trap proxy, because the code they covered is gone.
- Four tests in `tests/app-database-role.test.js` assumed one append-only collection. They now require both `adminAuditLog` and `tradingLedger`, which is stricter.
- `scripts/acceptance/trading-e2e.js` was rewritten: its G0 checks described containment screens that no longer exist.

### 23.8 Findings reconciliation

| ID | Status | How |
|---|---|---|
| P10-01 | **Resolved** | Internal simulator; per-student accounts |
| P10-02 | **Resolved for prices shown; real prices blocked** | No invented price anywhere; see 23.4 |
| P10-03 | **Resolved** | Server-set balance |
| P10-04 | **Resolved** | Margin, risk, size and instrument rules |
| P10-05 | **Resolved** | Results come from the ledger and positions; the old route returns no figures |
| P10-06 | **Resolved** | Positions, orders, append-only ledger |
| P10-07 | **Resolved** | POST only, CSRF |
| P10-08 | **Resolved** | Client order key, deterministic ids, operations |
| P10-09 | **Resolved** | Slot document; 30-way race passes on real MongoDB |
| P10-10 | **Resolved** | BigInt and Decimal128 |
| P10-11 | **Resolved** | Recoverable operations; 11 interruption points tested |
| P10-12 | **Resolved** | Unknown values show as unavailable |
| P10-13 | **Resolved** | No broker path remains |
| P10-14 | **Resolved** | Trading, tasks, journal and AI limits |
| P10-15 | **Resolved** | `instrumentOf` |
| P10-16 | **Resolved** | Quote age, calendar and integrity checks |
| P10-17 | **Resolved** | Per-student completion |
| P10-18 | **Resolved** | `taskIsFor` |
| P10-19 | **Resolved** | `instructorTeaches` |
| P10-20 | **Resolved** | `readJournalEntry` |
| P10-21 | **Resolved** | `isStoredId` on the changed routes |
| P10-22 | **Resolved** | `no-store` |
| P10-23 | **Resolved** | No email or broker id in new records; old rows untouched |
| P10-24 | **Resolved** | Stored order lifecycle |
| P10-25 | **Closed, not applicable** | OANDA mapping is no longer used |
| P10-26 | **Open: owner decision** | Retention policy, 23.5 |
| P10-27 | **Resolved** | Suites in 23.7 |
| P10-28 | **Resolved in code; production build pending** | T1-T10. `demoTasks` and `demoTaskSubmissions` indexes were not added |
| P10-29 | **Partly resolved** | Batched submission reads; the notification loop for general tasks remains |
| P10-30 | **Open, accepted** | Journal `grade` and `feedback` still have no writer. The page shows them only if present, so nothing is wrong on screen |
| P10-31 | **Open, accepted** | `/student-dashboard` and `/demo-trading` still overlap. Product work, not safety |
| P10-32 | **Closed: existing policy** | Super Admin stays excluded from task routes, as recorded in Phase 1-3 |
| P10-33 | **Resolved** | "Not in use" notices on both broker documents; page wording corrected |
| P10-34 | **Closed, not applicable** | Broker factory is unused |
| P10-35 | **Resolved** | Method checks; a GET cannot complete a task (live) |

### 23.9 Known limitations and outstanding risks

**Blocking**
1. **No approved market data.** The desk stays suspended until an owner-approved dataset exists.
2. **All financial evidence uses synthetic quotes.** Mechanics are proven; behaviour on real data density, gaps and spreads is not.

**Model limitations, disclosed to students where they matter**
3. Replay ends when the data ends, and then the desk suspends. Open positions stay open with no price until new data arrives. Long-term operation needs a plan for extending or re-anchoring data.
4. All students share one replay clock.
5. The calendar closes only weekends, 25 December and 1 January. Early closes and thin holiday sessions are not modelled; missing quotes are refused instead.
6. No partial close, commission, swap or slippage.

**Operational**
7. A hard process kill was not exercised. Interruption was tested by failing real driver calls at chosen points, which covers the same recovery path but not an operating-system crash.
8. Local MongoDB is a standalone server. Atlas behaviour, topology and latency are unverified.
9. The evaluator runs inside the web process, so it depends on a single always-on instance for timeliness. Several instances are safe because operations are guarded, but this was only tested as concurrent evaluation in one process. `sweep` handles at most 200 accounts per pass.
10. A fill interrupted before it was applied is abandoned after 2 minutes; during that window the order shows as in progress.
11. An account with a stranded position after data ends cannot be reset until it can be closed.
12. Rate-limit counts are per student per window and were tested on one server.

**Unresolved owner matters:** data licence, retention (P10-26), and the legal question in section 21 item 7, which is not an engineering one.

**Release stacking:** Phases 7, 8, 9 and 10 are unpushed, and Phase 8 must not ship alone. Production also still needs the Phase 8 L8/L9 indexes and the Phase 9 items recorded in its report.

### 23.10 Release and rollback requirements

Each step needs its own owner approval. None has been done.

1. Commit Phase 10, then agree the release order for Phases 7-10.
2. Read-only production inventory: `demoAccounts` and `demoTrades` counts, broker variables, Atlas topology, Render instance count.
3. Update the production database role **before** deploying, then confirm with `scripts/check-db-role.js`. If the app runs under the custom role, opening an account fails without this step.
4. Run `scripts/trading-indexes.js` read-only, then with `--apply`.
5. Deploy. With no approved dataset the desk is suspended, which is the safe default and needs no flag.
6. Remove unused `OANDA_*` and `BROKER_*` variables if present, and confirm `NEXT_PUBLIC_BROKER_API_ENABLED` is not depended on.
7. Live checks: suspended state, account creation, refusal of orders, no-store, CSRF, retired routes at 410.
8. Only after a licence is approved: import the dataset inactive, review it, activate it, run a staff trade, run `scripts/trading-reconcile.js`, then open to students.

**Monitoring:** `tradingEvaluator` failures in the log, and `scripts/trading-reconcile.js` on a schedule the owner sets. Any mismatch needs review, because nothing repairs itself.

**Rollback**
- Suspend trading without a deploy: set the active dataset's `active` to false. This is the first response to any data problem.
- Stop the evaluator: `TRADING_EVALUATOR_INTERVAL_SECONDS=0` and a restart.
- Roll back code: redeploy the previous commit. New collections are additive and old code ignores them. The broker routes return with the old code, including its defects, so a rollback to before G0 is not recommended.
- Do not delete `trading*` collections or edit the ledger as part of a rollback. Index and role additions can stay.
