# Phase 4.5 implementation report: HttpOnly cookie sessions

Date: 31 October 2026. Branch `feat/phase-4-5-secure-sessions` in worktree `forexorbit_academy-phase-4-5-secure-sessions`, based on `f3e728a`.

**Status: implemented, validated locally and committed on the local branch only (owner-approved). Not pushed, not merged, not deployed. Nothing in production was changed.** Production activation requires the owner steps in `production-activation-checklist.md`.

The report is in three separate parts: implementation, local validation, and production activation.

## 1. Implementation

### Server

- **Session store** (`lib/session-core.js`):
  - opaque 256-bit ids; only the SHA-256 is stored;
  - 30-minute idle timeout, 12-hour absolute lifetime;
  - rotation every 15 minutes with a 30-second grace window;
  - reuse detection that revokes the whole sign-in and logs it;
  - race-safe rotation through a conditional claim;
  - generation binding to `users.sessionGeneration`;
  - revocation helpers.
- **Cookie** `__Host-fo_session`: HttpOnly, Secure, SameSite=Lax, Path=/, host-only, Max-Age equal to the time left before the absolute expiry.
- **`withAuth`** (`lib/auth-middleware.ts`) reads only the cookie. It checks Origin and CSRF on state-changing methods, and the roles from the live record. Bearer tokens are accepted nowhere except the temporary upgrade route.
- **Routes:**

  | Route | Change |
  |---|---|
  | login, signup | set the cookie and return the profile only |
  | `POST /api/auth/logout` | new |
  | logout-all | also revokes stored sessions and sockets |
  | change-password | ends every session, then issues a new cookie for this browser |
  | me | GET only, `no-store` |
  | course list | optional session for progress |

- **Security events:** password reset, suspension, role change and deletion revoke stored sessions and disconnect sockets. A role change now also raises `sessionGeneration`. That is new: the person signs in again under the new role.
- **CSRF and Origin** (`lib/request-guard.js`), enforced in `middleware.ts` for every `/api` request and again in `withAuth`:
  - the trusted Origin (or Referer) is required;
  - `X-FO-CSRF: 1` is required;
  - only the signed Paystack webhook is exempt;
  - production without `APP_ORIGIN` refuses all such requests, and `server.js` refuses to start.
- **CORS:** exact `APP_ORIGIN` only. Wildcard `*.vercel.app` / `*.onrender.com` echoes removed from `lib/cors-origin.ts`, `server.js`, `pages/api/ai/answer-question.ts`, `pages/api/ai/check-config.ts` and `pages/api/consultations/agora-token.ts`.
- **Sockets** (`server.js`):
  - `allowRequest` origin check: no more "no Origin = allowed", no platform wildcards;
  - cookie handshake with no rotation;
  - re-check before events when the last check is over 30 s old;
  - a 30-second sweep of every socket;
  - `session_ended` before the disconnect;
  - immediate disconnection from API routes through `lib/session-sockets.js`.
- **Temporary legacy bridge:**
  - `POST /api/auth/session/upgrade` exchanges a valid pre-4.5 token once;
  - it is closed unless `AUTH_LEGACY_BEARER_UNTIL` is set, and ignored after the hard stop of 2027-01-31;
  - it is rate-limited and CSRF-checked;
  - it is marked TEMPORARY with removal steps.
- **Database:**
  - `sessions` added to the app role definition (`lib/app-database-role.js`);
  - idempotent index script `scripts/session-indexes.js` (S1 `userId`, S2 `familyId`, S3 TTL on `absoluteExpiresAt` + 1 day).

### Browser

These files no longer read or write a credential:

- `hooks/useAuth.tsx`
- `hooks/useSocket.ts`
- `lib/api-client.ts`
- `lib/ai-client.ts`
- `pages/certificates.tsx` (2 calls)
- `pages/consultations/chat/[sessionId].tsx`
- `components/AIAssistant.tsx` (2)
- `components/RichTextEditor.tsx`
- `components/InstructorLessonEditor.tsx`
- `components/AccountSecurity.tsx`
- `pages/onboarding.tsx`
- `pages/profile.tsx`

Behaviour:

- Every API call goes through `apiClient`, `aiClient` or `apiFetch`, with credentials and the CSRF header.
- The profile is in React state only. It is re-read from `/auth/me` after a reload, with two retries on network failure.
- Tabs sync on a BroadcastChannel that carries event names only.
- The socket connects to the page origin and re-checks the session on `session_ended`.
- Sign-out (Header and Sidebar) now calls the server.
- The only remaining `localStorage` access is the temporary one-time migration: read the old token, delete `token` and `user`, exchange once.

### Not present, not added

- Email verification does not exist in this codebase (Phase 1–3 decision).
- An admin screen to end one device's session: the helper exists, the UI does not.

## 2. Local validation (31 October 2026)

| Check | Result |
|---|---|
| `npm test` | **746/746** (708 existing + 38 new in `tests/secure-sessions.test.js`) |
| TypeScript `tsc --noEmit` | 0 errors |
| ESLint | 0 errors; 616 warnings (612 before; the new ones are `require()` style in CommonJS libraries, the existing convention there) |
| `next build` | passes |
| Acceptance guard tests | 4/4 |
| Phase 4 acceptance (`scripts/acceptance/run.js`, real app, real local MongoDB 9.0.4, headless Edge) | **77/77**: the 72 Phase 4 checks now run on cookie sessions, plus 5 new browser checks |
| Session end-to-end (`scripts/acceptance/sessions-e2e.js`, real app, Socket.IO client, two Edge tabs) | **36/36** |
| Production-mode build (`scripts/start-production.js`, `APP_ORIGIN` set only at run time) | middleware enforced the run-time `APP_ORIGIN`: trusted origin + header reached the route (401 bad credentials); missing header, localhost and the Vercel origin got 403; preflight echoed only `APP_ORIGIN`; a non-https `APP_ORIGIN` stopped start-up |
| Session index script on a local `_test` database | missing ×3 → built 3 → present ×3; second `--apply` built nothing; `Forex_elearning` on a local host and a non-test local database refused |
| `git diff --check`, secrets guard (`scripts/guard-commit-paths.js`), no `mongodb+srv://` literal, no key patterns | clean |

The 5 new browser checks in the Phase 4 acceptance run are:

- the cookie is HttpOnly, Secure, SameSite=Lax and host-only;
- `document.cookie` does not show the session;
- no token or user in localStorage, sessionStorage or IndexedDB;
- a reload keeps the session;
- sign-out ends the session and clears the cookie.

### What the new tests cover

- **Cookie attributes:** exact cookie string, cleared cookie, Max-Age, parsing that refuses duplicates and malformed values.
- **Ids:** 256-bit, hash-only storage, generation binding.
- **Expiry:** idle (with activity keeping it alive), absolute (with rotation never extending it); idle expiry also over a live socket.
- **Rotation:** 15-minute rotation; 30-second grace for parallel tabs; reuse after grace revokes the family and is logged without the id; concurrency (5 simultaneous requests → exactly 1 successor, all succeed; live: 3 parallel → 1 rotation); a failed successor insert is undone.
- **Revocation:** sign-out (one device), sign out everywhere, password change and reset, suspension, role change, deletion; socket disconnection for each, live where possible.
- **CSRF:** every unsafe method with a foreign or platform origin, no origin, `null` origin, a missing or wrong header; Referer fallback; safe methods; the webhook exemption; production without `APP_ORIGIN`; live through the real Edge middleware, including login CSRF and cross-site sign-out.
- **Origin and CORS:** `APP_ORIGIN` validation; exact CORS with no wildcards; live preflights.
- **Sockets:**
  - unit: origin decision and server wiring;
  - live: cookie and Origin accepted; foreign Origin refused; no Origin and no fetch metadata refused; no cookie refused; unknown session refused; a bearer token in the handshake refused; disconnection on sign-out, sign out everywhere, suspension and idle expiry.
- **Accounts and roles:** inactive accounts (pending, rejected, suspended, unknown role, deleted); roles from the live record; Super Admin-only approval.
- **No credential in the browser:**
  - source scan of every page, component and hook: no storage writes, no reads outside the migration, no `Authorization` header, no `document.cookie`, no IndexedDB;
  - live in Edge.
- **No leakage:** no token in response bodies; no session id in logs; the security log holds neither id nor hash; the server log holds no fixture email.
- **Refresh recovery:** live in Edge.
- **Multiple tabs:** live, two Edge tabs; signing out in one sends the other to `/login`.
- **Legacy window:** every state; the upgrade route closed, open, cross-site, forged, stale generation, inactive account.
- **Indexes:** idempotence, unknown and conflict refusal, shared target rules.

Each core rule was mutation-checked: removing it makes at least one test fail. The rules checked were the CSRF header check, the origin check, reuse detection, the generation check, the idle expiry and the conditional rotation claim.

### Existing tests changed

27 existing tests asserted the bearer design. Each was moved to cookie sessions with the same or a stronger assertion; none was deleted or weakened:

- route tests now sign in with a stored session (`tests/helpers/session-cookie.js`) and send the Origin and CSRF headers;
- source-contract tests now assert the cookie design (for example "login starts a cookie session and never returns a token");
- one expectation changed for a stronger reason: after suspension, the old session now answers **401** (revoked at once) instead of 403.

### Defects found and fixed during validation

1. Socket idle expiry could take up to about 60 s. The sweep skipped recently checked sockets. Now every socket is re-checked on each 30-second tick.
2. Cookie Max-Age was one second short (two clock reads). It is now computed from the session's own creation time.
3. `pages/api/consultations/agora-token.ts` still echoed any `*.vercel.app` origin with credentials. Fixed and added to the CORS test.

### Not validated locally

- **Firefox and Safari.** The browser checks ran in headless Edge (Chromium) only. Safari's handling of `Secure` cookies on `http://localhost` differs, so staging over HTTPS is needed.
- **Real HTTPS and the production hosting layout.** Everything ran on `http://localhost`, which Chromium treats as secure. Layout B (Vercel rewrite of `/api/socket` with polling) was not tried and needs the transport-order change described in `rollout-plan.md`.
- **The legacy upgrade with the window open** was tested in-process only. Live, only the closed state was checked.
- **Atlas permissions:**
  - not tested whether `forexorbitAppRole` with the new privilege can create `sessions` implicitly; the plan builds the indexes first;
  - the TTL deletion itself was not observed (it runs about once a minute on the server and was not waited for).
- **One session end-to-end run ended early** at 24/25 with a setup failure whose cause was not captured. It may have been the previous run's server still holding the port. The next three runs completed (36/36 the last two).

## 3. Production activation (owner; nothing done)

- Hosting: Option A decided (Render as `APP_ORIGIN`, `hosting-architecture.md`). The Vercel redirect is still to be configured.
- Index build by a privileged account.
- App-role privilege on `sessions`.
- `APP_ORIGIN` and `AUTH_LEGACY_BEARER_UNTIL`; unset the cross-origin variables.
- Staging in Chrome, Firefox and Safari over HTTPS.
- Deploy, monitor, close the legacy window, then remove the bridge code.

See `rollout-plan.md`, `production-activation-checklist.md`, `rollback-plan.md`, `database-role-and-indexes.md` and `environment.md`.

## Files

**New:**

- `lib/session-core.js`
- `lib/session-auth.ts`
- `lib/request-guard.js`
- `lib/session-sockets.js`
- `lib/session-indexes.js`
- `lib/legacy-bearer.js`
- `lib/api-fetch.ts`
- the `.d.ts` files for the new modules
- `pages/api/auth/logout.ts`
- `pages/api/auth/session/upgrade.ts`
- `scripts/session-indexes.js`
- `scripts/acceptance/sessions-e2e.js`
- `tests/secure-sessions.test.js`
- `tests/helpers/session-cookie.js`
- `docs/phase-4-5/*`

**Changed:**

- the auth routes listed above;
- `lib/auth-middleware.ts`, `lib/cors-origin.ts`, `middleware.ts`, `server.js`;
- `lib/account-approval.js`, `lib/password-reset.js`, `lib/app-database-role.js`;
- the client files listed above;
- `components/Header.tsx`, `components/Sidebar.tsx`;
- `pages/api/courses/index.ts`, the AI routes, `pages/api/consultations/agora-token.ts`;
- `scripts/acceptance/run.js`;
- `.env.example`, `package.json` (test list);
- 11 existing test files.

The gitignored local `.env.acceptance` in this worktree points at the local server only.
