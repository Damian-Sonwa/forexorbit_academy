# Phase 4.5 architecture: HttpOnly cookie sessions

Branch `feat/phase-4-5-secure-sessions`, based on the Phase 4 integration commit `f3e728a`.

## Before and after

| Area | Before (f3e728a) | Phase 4.5 |
|---|---|---|
| Credential | 7-day HS256 JWT in `localStorage.token` | 256-bit random session id in the `__Host-fo_session` cookie: HttpOnly, Secure, SameSite=Lax, Path=/, host-only |
| Server state | none per session; `users.sessionGeneration` ended all sessions at once | `sessions` collection, one row per sign-in and rotation, storing only the SHA-256 of the id |
| Lifetime | 7 days | 30-minute idle timeout and 12-hour absolute lifetime from sign-in |
| Rotation | none | new id every 15 minutes of use; a 30-second grace window for parallel tabs; reuse after the grace window revokes the whole sign-in |
| Sign out | client-only (the token stayed valid) | `POST /api/auth/logout` revokes the session and its sockets, then clears the cookie |
| Sign out everywhere | generation increase | generation increase, plus every stored session revoked and every socket disconnected |
| CSRF | none (header credential) | trusted `Origin` (or `Referer`) and the `X-FO-CSRF: 1` header on every state-changing `/api` request |
| CORS | echoed any `*.vercel.app` / `*.onrender.com` origin with credentials | only the exact `APP_ORIGIN` (and the local dev server outside production) |
| Sockets | `auth: { token }`; requests with no Origin accepted | the same cookie; Origin checked; session re-checked per event and every 30 seconds |
| Browser storage | `token` and `user` in localStorage | nothing; the profile is in React state and re-read from `/api/auth/me` |

## Components

```
browser (one origin: APP_ORIGIN)
  ├─ pages ──────────────────────────────── Next.js
  ├─ /api/* ── middleware.ts ── Origin/CSRF gate (lib/request-guard.js), exact CORS
  │              └─ route ── withAuth (lib/auth-middleware.ts)
  │                             ├─ checkRequestOrigin (again, defence in depth)
  │                             └─ authenticateRequest (lib/session-auth.ts)
  │                                  └─ resolveSession (lib/session-core.js) ── sessions, users
  └─ /api/socket ── server.js Socket.IO
                      ├─ allowRequest: decideSocketOrigin
                      ├─ io.use: readSessionCookie + resolveSession({ rotate: false })
                      ├─ socket.use: re-check before an event if the last check is over 30 s old
                      └─ sweep every 30 s: re-check every socket; end it on failure
```

| File | Role |
|---|---|
| `lib/session-core.js` | Session ids, hashing, cookie strings, `decideSession` (pure), `createSession`, `resolveSession`, `rotateSession`, revocation helpers, `endAccountSessions` |
| `lib/session-auth.ts` | Next API glue: `authenticateRequest`, `startSession`, `endCurrentSession`, `endAllSessions`, `checkRequestOrigin`, `appendSetCookie` |
| `lib/request-guard.js` | `APP_ORIGIN` validation, trusted origins, CSRF/Origin decision, socket origin decision, exact CORS |
| `lib/session-sockets.js` | Disconnects sockets of a user or of one sign-in; a process-wide slot shares the Socket.IO server between `server.js` and the separately compiled API routes |
| `lib/session-indexes.js`, `scripts/session-indexes.js` | Index definitions and the idempotent index script for a privileged account |
| `lib/legacy-bearer.js`, `pages/api/auth/session/upgrade.ts` | **Temporary** one-time exchange of a pre-4.5 token for a cookie session, closed by default |
| `lib/api-fetch.ts` | `fetch` wrapper for uploads and downloads: sends the cookie and the CSRF header |
| `hooks/useAuth.tsx` | No storage. Profile in React state. Start-up `/auth/me` with retries. BroadcastChannel tab sync. One-time legacy migration |
| `hooks/useSocket.ts` | Connects to the page origin with credentials. Reacts to `session_ended` |

## Why opaque server-side sessions rather than JWT access and refresh tokens

- Revocation is immediate and per device; no token remains valid until it expires.
- Nothing usable is stored by JavaScript, so an injected script cannot copy the credential. It can still act inside the open page while it runs; the sanitizer and link fixes of Phase 4 and the CSP remain the defence there.
- The cost is one indexed lookup per request (by `_id`) plus at most one write per minute (`lastSeenAt`). The previous design already read the user record on every request.

## One canonical origin

The cookie is host-only (`__Host-` prefix), so the browser sends it only to the origin that set it. Pages, API and Socket.IO must therefore be reachable on one HTTPS origin, `APP_ORIGIN`. `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` must be unset or equal to it. The socket client now always uses the page origin. The chosen layout (Render as the single origin) and its evidence are in `hosting-architecture.md`.

## Authorization is unchanged

The session yields only the account id. Role, status and every object-level check still come from the live `users` record and the existing `decide*` functions. `withAuth(handler, roles)` keeps its signature. Approval and rejection of registrations stay Super Admin only (`decideApprovalRequest`); this is tested again in `tests/secure-sessions.test.js`.

## What did not exist and was not added

- **Email verification** does not exist in this codebase (Phase 1–3 decision). Phase 4.5 adds none. Signup signs in only auto-approved students; pending instructors get no session.
- **Admin "end one session" UI.** The helpers exist (`revokeFamily`); there is no screen.
