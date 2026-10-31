# Session lifecycle

All times are owner decisions (31 October 2026) and constants in `lib/session-core.js`.

| Constant | Value |
|---|---|
| `IDLE_TIMEOUT_MS` | 30 minutes |
| `ABSOLUTE_LIFETIME_MS` | 12 hours from sign-in |
| `ROTATION_INTERVAL_MS` | 15 minutes |
| `ROTATION_GRACE_MS` | 30 seconds |
| `TOUCH_INTERVAL_MS` | `lastSeenAt` written at most once a minute |

## Stored record (`sessions`)

```
_id               SHA-256 hex of the session id (the id itself is never stored)
userId            account id (string)
familyId          random id shared by one sign-in and all its rotations
generation        users.sessionGeneration at sign-in
createdAt         when this id was issued
familyCreatedAt   when the person signed in
lastSeenAt        last request (idle timeout measured from here)
absoluteExpiresAt familyCreatedAt + 12 h (never extended); TTL index removes the row a day later
rotatedAt, rotatedTo   set when this id was replaced
revokedAt, revokeReason set when ended
```

## Sign-in

1. `POST /api/auth/login` (CSRF gate, rate limits, password check, account status).
2. Any session this browser already carried is revoked (`replaced_by_login`).
3. A new id: `crypto.randomBytes(32)` (base64url, 43 characters). Its hash is inserted.
4. `Set-Cookie: __Host-fo_session=<id>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`.
5. The body carries the profile only. The client then reads `/api/auth/me`.

Signup signs in only approved accounts (students). Pending instructors get no session and wait for the Super Admin.

## Every request

`resolveSession` (HTTP via `withAuth`, sockets via `server.js`) checks, in order:

| Check | Result if it fails |
|---|---|
| cookie present and well-formed (one value only) | 401 |
| row exists | 401 `unknown` |
| not revoked | 401 `revoked` |
| before `absoluteExpiresAt` | 401 `expired_absolute`, row revoked |
| `lastSeenAt` within 30 minutes | 401 `expired_idle`, row revoked |
| not rotated, or rotated less than 30 s ago | 401 `reuse`: **the whole family is revoked** and `session_reuse_detected` is logged (no id or hash in the log) |
| account active (`decideAccountAccess`) | 403 (or 401 if deleted), row revoked |
| `users.sessionGeneration` equals the row's | 401 `generation`, row revoked |

A refused HTTP request also clears the cookie. On success:

- if 15 minutes have passed since this id was issued (and this is not a grace-window request), the id is **rotated**:
  - a conditional update claims the row (`rotatedAt: null`);
  - only one concurrent request can win;
  - the successor is inserted with the same family and absolute expiry;
  - the new cookie is set on that response.

  Requests that lost the claim, or that arrive within 30 s with the old id (other tabs), still succeed.
- otherwise `lastSeenAt` is refreshed at most once a minute.

Sockets never rotate (no cookie can be set there).

## Multiple tabs

All tabs share the cookie jar. A rotation in one tab is seen by the others at their next request. Requests already in flight with the old id are accepted for 30 seconds.

Sign-in and sign-out are announced on `BroadcastChannel('forexorbit-auth')` with the event name only (`signed-in` / `signed-out`). A tab that becomes visible re-reads `/auth/me` (throttled to once a minute). A socket that receives `session_ended` triggers the same re-check.

## Reload

Nothing is kept in browser storage. After a reload, `useAuth` reads `/api/auth/me`:

- 200 restores the profile;
- 401 means signed out;
- other failures are retried twice (0.5 s, 1.5 s) before the tab is shown as signed out.

## Ending sessions

| Event | Effect |
|---|---|
| Sign out (`POST /api/auth/logout`) | the family is revoked, its sockets disconnected (`session_ended`), the cookie cleared. Other devices stay signed in. Always 200. |
| Sign out everywhere | generation +1, every row revoked, every socket of the account disconnected, cookie cleared |
| Password change | generation +1, every row revoked and sockets ended, then a **new** session for this browser |
| Password reset | generation +1 (existing), every row revoked, sockets ended. No automatic sign-in. |
| Suspension (Super Admin) | generation +1 (existing), every row revoked, sockets ended |
| Role change (Super Admin) | **new:** generation +1, every row revoked; the person signs in again under the new role |
| Account deletion (Super Admin) | every row revoked, sockets ended |
| Idle 30 min / 12 h reached | refused at the next request; sockets ended by the 30-second sweep |
| Reuse of a retired id | the whole family revoked |

Socket disconnection is immediate for sockets on the same server process. On another process it happens at that socket's next event (if its last check is over 30 s old) or at the next sweep (at most 30 s).

## Clean-up

The TTL index `session_ttl` deletes rows one day after `absoluteExpiresAt`. Until then revoked and rotated rows stay, so a replayed old id is recognised as reuse.
