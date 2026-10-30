# H1 — Authentication rate limiting (login and signup)

Phase 1 authentication audit, finding H1. Branch `claude/intelligent-meitner-2qikrv`, 2026-10-30. This file covers the code changes only: no production data, indexes or environment variables were changed.

## Original problem

`POST /api/auth/login` and `POST /api/auth/signup` had no rate limit. Anyone could make unlimited password guesses against any email, from one address or many, and create unlimited accounts. Every attempt also cost a bcrypt computation on the server.

## Policy

Every attempt counts, including failures and malformed but complete requests. The limit is checked after the cheap input checks and before any user lookup, password check, password hash or insert. Windows are fixed 10-minute windows. Nothing is stored on the account, and no account is ever locked; throttling ends when the window ends.

| Route | Rule | Key | Limit per 10 min |
|---|---|---|---|
| Login | `login-ip` | client network | 30 |
| Login | `login-email-ip` | normalized email + client network | 10 |
| Login | `login-email` | normalized email | 50 |
| Signup | `signup-ip` | client network | 10 |
| Signup | `signup-email` | normalized email | 5 |

- **Email normalization:** `trim().toLowerCase()`, exactly as login and signup store and look up emails.
- **When a rule refuses:** the response is 429, with `Retry-After` set to the seconds left in the window and `Cache-Control: no-store`. The body is `{ error, code: 'rate_limited', retryAfterSec }`, identical for login and signup and whether or not the email has an account.
- **Why three login rules:**
  - `login-ip` stops one source from trying many accounts.
  - `login-email-ip` stops one source from working on one account.
  - `login-email` caps a distributed attack on one account.

  The per-email cap is the loosest, so the account owner, signing in from their own address, is only throttled if someone keeps up more than 50 attempts per window against that email, and then only until the window ends. Without a second factor (out of scope here), no rate limit can both cap distributed guessing on one account and never throttle its owner.
- **Signup:** the per-email rule limits repeated attempts on one address, for example to probe which emails are taken. The Student and Instructor-only role rule (H3) is checked before the limit and is unchanged.

## Storage, atomicity and expiry

- **In-process count:** each rule first counts in the process (`lib/rate-limit.js`). For the auth limiters it is capped at 50,000 windows per rule: expired windows are dropped first, then the oldest. Existing callers (payments, ledger) don't pass a cap and keep their exact previous behaviour.
- **Shared count:** when `SHARED_RATE_LIMIT=mongodb` is set, each rule is also counted in `rateLimits` through `consumeSharedLimit`. That is one atomic `findOneAndUpdate` with `$inc` and an upsert per rule; the window document `_id` is `rule:key:windowStart`. MongoDB applies single-document updates atomically, so simultaneous requests on any number of instances get distinct counts and can't exceed the limit. This is the same mechanism and switch as the payment and ledger limits (D10).
- **Keys:** an HMAC-SHA256 (keyed with `JWT_SECRET`) of the rule, the normalized email and the client network, truncated to 40 hex characters. No raw email or address is stored.
- **Expiry:** every window document has `expiresAt` set to the window end. The TTL index R1 (`rateLimits.expiresAt`, `expireAfterSeconds: 0`) deletes them, which keeps the collection bounded. R1 is built by `node scripts/course-payment-indexes.js --database <name> --apply`, together with I1–I6. That script refuses while its duplicate scans report problems.
- **Store load:** a login with the shared count on makes up to three single-document upserts; a signup makes up to two.

## Failure policy

- **Shared count on, store unreachable:** login and signup return **503** `{ error, code: 'rate_limit_unavailable' }`, before any user lookup or bcrypt work. They fail closed, like the payment and ledger limits. Sign-in and sign-up read the same database, so they couldn't succeed during such an outage anyway, and the limit is never silently skipped.
- **Shared count off (the current default):** only the in-process limits apply. That is complete protection with one instance. With several instances each one counts separately, so the effective limit is multiplied by the instance count. Memory is bounded, as described above.

## Client address

`lib/client-ip.js`:
- **`X-Forwarded-For`:** a client can write anything into it. The helper uses the entry `TRUSTED_PROXY_HOPS` places from the right; the default is 1, meaning one platform proxy that appends the address it received the request from. Entries to the left, written by the client, are never used. If there are fewer entries than trusted hops, the header is ignored. `TRUSTED_PROXY_HOPS=0` ignores the header entirely.
- **Fallback:** if the header is missing, malformed or ignored, the socket address is used.
- **Normalization:** addresses are validated with `net.isIP`. Ports, brackets and IPv4-mapped prefixes are removed, and IPv6 is grouped by /64, since one subscriber usually holds a whole /64.
- **No usable address:** the address rules are skipped. Requests are never grouped under a shared "unknown" key, which would throttle everyone together. The email rules still apply.
- **Existing reset routes:** the three password-reset routes still read the left-most entry for logging only. Changing them belongs to H2.

**Not verified: the deployment's proxy model.** The repository doesn't say how many proxies sit in front of the app on Render, or on Vercel if it also serves `/api`, and their documentation couldn't be reached from the build environment.
- If exactly one proxy appends to the header, the default is correct.
- If there are two (for example a CDN in front of the platform proxy), every user would appear under the first proxy's address, and the per-address limits would act like global limits. Set `TRUSTED_PROXY_HOPS=2` in that case.
- If the app is ever reached directly, a client could choose its own address; set `TRUSTED_PROXY_HOPS=0`. The email limits hold either way.

To verify after deployment, sign in with a wrong password from two different networks: each should get its own 30-attempt per-address budget. Then check from one network that the 11th attempt on the same email is refused.

## Production prerequisites (owner actions, not done here)

1. **Cross-instance enforcement:** build R1 in production, then set `SHARED_RATE_LIMIT=mongodb`, following `docs/audits/production-database-runbook-indexes-and-role.md`, steps 7–8. Until then only the in-process limits apply. Also set it on Vercel if Vercel serves `/api`: serverless instances don't share memory, so in-process limits there are weak.
2. **Proxy hops:** confirm the proxy hop count and set `TRUSTED_PROXY_HOPS` if it isn't 1.
3. **`JWT_SECRET`:** keep it set; it keys the stored rate-limit hashes. Rotating it starts new counts.

## Tests

`tests/auth-rate-limit.test.js` (20 tests) runs the real login and signup handlers. Each route is loaded twice, as two instances with separate in-process limiters sharing one store, against an in-memory database. A controlled clock and spies count bcrypt calls and user reads and writes. It covers:
- every limit and its boundary;
- email normalization;
- independence of addresses and accounts;
- the unchanged success responses, session binding included;
- identical responses for existing and unknown accounts, both for 401 and 429;
- `Retry-After`;
- 40 simultaneous requests across two instances (exactly 10 reach the password check);
- no hashing or writes when signup is refused;
- the H3 role rule;
- window expiry and reset;
- the 503 policy;
- keys with no raw data;
- unknown addresses;
- the address-parsing cases;
- bounded memory.

Run against the previous `login.ts`, every enforcement test fails.

The store stand-in applies upserts atomically, as MongoDB does for one document, but it doesn't run MongoDB itself. A real multi-process run (as in `scripts/payment-concurrency-rehearsal.js`, which already passed for the same limiter with 8 processes) and the TTL monitor's deletions weren't exercised here, because there was no MongoDB server in the build environment.
