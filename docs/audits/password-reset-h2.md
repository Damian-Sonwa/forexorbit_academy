# H2 — Password reset security and rate limiting

Phase 1 authentication audit, finding H2. Branch `claude/intelligent-meitner-2qikrv`, 2026-10-30. Code changes only: no production data, indexes or environment variables were changed.

## Original problems (confirmed in code)

1. **Code guessing:** `verify-password-otp` read `otpAttempts`, compared the code, then wrote `otpAttempts + 1`. Simultaneous requests all read the same count, so a 6-digit code could be compared any number of times within its 5 minutes.
2. **Duplicate tickets:** a correct code sent several times at once produced several tickets.
3. **Duplicate resets:** a ticket submitted several times at once changed the password several times.
4. **No rate limits** on any of the three routes. The per-account cooldown and hourly cap were counted from log entries, so they were racy too: simultaneous requests could send several SMS and leave several live codes.
5. **Spoofable address:** each route read the left-most `X-Forwarded-For` entry, which the client writes.
6. **Account enumeration:** `verify-password-otp` returned `attemptsRemaining` and `locked` only when a code existed. Calling forgot-password and then a wrong verify therefore revealed whether a number had an account.

## Mechanism

### Verify (`pages/api/auth/verify-password-otp.ts`)

1. **Reserve an attempt atomically:** one `findOneAndUpdate` on the newest reset record of the account whose code is unexpired (`otpExpiresAt > now`), unused (`otpHash` is a string) and has attempts left (`otpAttempts < 3`). It applies `$inc: { otpAttempts: 1 }`. MongoDB applies this to one document atomically, so at most 3 requests ever get a reservation for a code, however many arrive at once.
2. **Compare:** only a request holding a reservation compares the code.
3. **Consume the code:** a correct code is consumed with one conditional `updateOne` (same `_id`, same `otpHash`, still unexpired). It clears `otpHash` and sets the ticket. Only the first correct request matches, so a code yields exactly one ticket.
4. **Failures:** every failure gets the same 400 body: unknown number, no code, wrong code, expired code, or no attempts left. `attemptsRemaining` and `locked` are no longer returned. A failure without a reservation still runs one bcrypt comparison against a placeholder hash, so failures take similar time.
5. **Cleanup:** expired codes are deleted. A code with no attempts left is not deleted while requests may still be in flight. Deleting it would cancel a correct attempt reserved earlier that is still finishing; a test covers this. It can't be reserved again, and it's removed by the next code request or by a completed reset.

### Reset (`pages/api/auth/reset-password.ts`)

1. **Validate:** the ticket (48 hex) and secret (64 hex) formats are checked first.
2. **Find and check:** the record is found by ticket and the secret compared with bcrypt. A wrong secret doesn't use up the ticket.
3. **Claim:** the record is claimed with one `findOneAndDelete` (same `_id`, ticket and secret hash, `passwordStepExpiresAt > now`). Only one request can claim it, so the password changes at most once per ticket.
4. **Apply:** the claimer sets the new bcrypt(10) hash, unchanged from before, and applies `$inc: { sessionGeneration: 1 }`. The auth middleware and socket handshake then reject every token issued before the reset. Remaining reset records for the account are deleted.
5. **Failure after the claim:** if the password write fails, the request returns 500 and the ticket is already used; the user starts again from Forgot password. This fails safe: the ticket never becomes replayable.

### Request (`pages/api/auth/forgot-password.ts`)

- **Limits first:** the shared limits run on every valid number before the account lookup and any SMS, so a refusal says nothing about whether the number has an account.
- **One-minute gate:** an atomic one-minute window per number (max 1) makes simultaneous requests for one number send at most one SMS and leave one live code. The existing log-based 60 s cooldown and 5-per-hour cap are unchanged and still answer with the generic 200 message.
- **SMS:** the SMS integration, message text and send-then-store order are unchanged. A failed or unconfigured SMS still returns the generic message and stores no code.

## Rate limits

Shared H1 limiter (`lib/auth-rate-limit.js`). Windows are 10 minutes unless noted. Keys are HMACs of the rule and its inputs, so stored keys hold no phone numbers, tickets, codes or secrets. Refusals are `429 { error, code: 'rate_limited', retryAfterSec }` with `Retry-After`, the same response as login and signup.

| Step | Rule | Key | Limit | Why |
|---|---|---|---|---|
| Request | `reset-request-ip` | client network | 10 | One source spraying numbers |
| Request | `reset-request-phone` | phone (E.164) | 5 | One number from many sources |
| Request | `reset-request-cooldown` | phone | 1 per **1 minute** | Atomic gate: one SMS and one live code per number per minute |
| Request | `reset-request-global` | service-wide | 300 | Caps SMS spend if many numbers are targeted |
| Verify | `reset-verify-ip` | client network | 20 | Automated guessing from one source |
| Verify | `reset-verify-phone` | phone | 10 | Guessing on one number from many sources |
| Complete | `reset-complete-ip` | client network | 10 | Ticket probing from one source |
| Complete | `reset-complete-ticket` | ticket | 5 | Repeated submissions with one ticket |

The 3-attempts-per-code limit on the reset record is the authoritative brute-force control. The verify limits only slow guessing across codes.

The global request cap is a trade-off: someone sending 300 requests per 10 minutes for different numbers could hold up legitimate reset requests until the window ends. Raise it in code if real traffic needs more.

## Failure policy

- **Shared store unreachable** (with `SHARED_RATE_LIMIT=mongodb`): all three steps return 503 `rate_limit_unavailable` before any lookup, comparison or SMS. They fail closed, as login, signup and payments do.
- **Shared count off (the default):** the limits are counted per process only, so with several instances each counts separately.
- **Code and ticket rules don't depend on that switch:** the attempt reservation, the single-use code and the single-use ticket are enforced on the reset record itself and always apply.

## Client address

All three routes now use `clientAddress()` from H1 (`lib/client-ip.js`):
- it reads the entry `TRUSTED_PROXY_HOPS` places from the right of `X-Forwarded-For` (default 1), falling back to the socket address;
- addresses are validated, and IPv6 is grouped by /64;
- with no usable address, the address rules are skipped rather than shared.

The same address is written to the security log. **The proxy hop count for Render and Vercel is still unverified** (see `auth-rate-limiting-h1.md`).

## Privacy

- **Responses:** request, verify and limit refusals are identical for numbers with and without accounts.
- **Logs:** security logs keep the masked last four digits of the number and the client address. They never contain codes, tickets, secrets or passwords. Rate-limit keys are HMACs.
- **Residual timing difference:** a request for a number with an account waits for the SMS provider; one without an account doesn't. Removing this would mean sending the SMS after responding, which needs a background job or queue. Not done in H2.

## Production prerequisites

1. **Cross-instance limits:** build R1 and set `SHARED_RATE_LIMIT=mongodb`, as for H1. The code and ticket rules don't depend on it.
2. **Proxy hops:** confirm the hop count and set `TRUSTED_PROXY_HOPS` if it isn't 1.
3. **No new indexes required.** `passwordPhoneResets` has no TTL index, as before. Records are removed by new requests, completed resets and verify-time cleanup of expired codes. A TTL index on a timestamp would bound storage further; that's a separate production change.
4. **Phone numbers:** password reset still finds users only by `phoneE164` or a legacy `phone` field. Phase 1 finding F1, that onboarding stores the number elsewhere, is still open and outside H2.

## Tests

`tests/password-reset.test.js` (28 tests) runs the real three routes against an in-memory MongoDB stand-in. Every operation yields to the event loop and then applies atomically, so simultaneous requests interleave the way real ones can. SMS is a recording stub that captures the code, and the clock is mocked. **This is a mocked store, not MongoDB.** It shows the routes are safe under per-operation interleaving; it doesn't exercise MongoDB's own concurrency, which was not run because no MongoDB server was available.

Run against the previous routes, the concurrency tests fail:

| Scenario | Previous routes | Now |
|---|---|---|
| 30 simultaneous wrong codes | **30** comparisons | 3 |
| 10 simultaneous correct codes | **10** tickets | 1 |
| One ticket submitted 4 times at once | **4** password changes | 1 |
