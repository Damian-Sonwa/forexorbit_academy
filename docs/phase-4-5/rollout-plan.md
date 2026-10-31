# Rollout plan

> **Superseded for the release** by `docs/release/production-deployment-runbook.md` (31 October 2026: Option A on Render decided; Vercel cutover order in decision D5). Kept for design background.

Status: **not started.** Nothing has been deployed, pushed or changed in production. Each stage needs the owner's explicit approval.

## 0. Hosting layout (decided: Option A)

Decision and evidence: `hosting-architecture.md`. In short, Render (`https://forexorbit-academy.onrender.com`, or a custom domain on the same service) becomes `APP_ORIGIN`. It already serves pages, API and WebSockets. The Vercel address becomes a permanent redirect to it (or is removed). Option B is not approved. The two options are kept below for reference.

### Reference: the two layouts

The cookie is host-only, so pages, API and sockets must share one HTTPS origin (`APP_ORIGIN`).

**Layout A, recommended: one service serves everything.**

- The browser uses the Render service (or a custom domain pointing to it).
- `server.js` serves pages, `/api/*` and `/api/socket`.
- WebSockets work.
- Set `APP_ORIGIN` to that origin.
- If the Vercel address must keep working, it only redirects (not proxies) to `APP_ORIGIN`.

**Layout B: Vercel is the origin and proxies sockets to Render.**

- Vercel serves pages and `/api/*`.
- A Vercel rewrite sends `/api/socket/:path*` to the Render service.
- Vercel rewrites do not carry WebSocket upgrades, so Socket.IO must run on HTTP long-polling. This needs a one-line change in `hooks/useSocket.ts`: `transports: ['polling', 'websocket']` (polling first). The Socket.IO client does not fall back from a failed WebSocket on its own. This change is not made in this branch.
- API routes on Vercel and sockets on Render share the `sessions` collection, so either side validates any session.
- Immediate socket disconnection after a Vercel-handled sign-out does not reach the Render process. The socket's per-event check and the 30-second sweep end it instead (at most about 30 seconds).
- `APP_ORIGIN` must be set on both Vercel and Render, at build and run time.

## 1. Database (privileged account, before any deploy)

See `database-role-and-indexes.md`.

1. Confirm a current backup or Atlas snapshot exists.
2. Run `scripts/session-indexes.js` read-only, then with `--apply`. This also creates `sessions`.
3. Add `find, insert, update(, remove)` on `Forex_elearning.sessions` to `forexorbitAppRole`.
4. Verify with `scripts/check-db-role.js`.

## 2. Configuration (owner, hosting dashboards)

- Set `APP_ORIGIN`.
- Set `AUTH_LEGACY_BEARER_UNTIL`, suggested release + 14 days (must be before `2027-01-31`).
- Keep `JWT_SECRET` unchanged.
- Unset `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL` unless they equal `APP_ORIGIN`. These are build-time values, so they need a rebuild. `ALLOWED_ORIGINS` can stay until step 6; it is ignored.

## 3. Staging (owner)

Deploy the branch to a staging service that has its own database (never the production database), with its own `APP_ORIGIN`. Then:

1. Run `scripts/acceptance/sessions-e2e.js` and `scripts/acceptance/run.js` against it, or follow the manual checks in `production-activation-checklist.md`, in Chrome, Firefox and Safari.
2. Check sign-in, reload, two tabs, sign-out, sign out everywhere, password change, suspension, and a lesson chat (socket).

## 4. Release

1. Merge and deploy (owner).
2. Users who were signed in before keep working: on their first page load the new bundle reads the old `localStorage.token`, deletes both keys, and exchanges the token once at `/api/auth/session/upgrade`.
3. Tabs still running the old bundle get 401 from every API (bearer tokens are no longer accepted anywhere else) and are sent to sign-in; reloading loads the new bundle.

## 5. Monitor (first days)

Watch for:

- login 500s, which point to a role or index problem;
- 403 `origin_*` / `csrf_header_missing` responses, which point to a client not sending the header or a wrong `APP_ORIGIN`;
- `socketOrigin refused` log lines;
- `session_reuse_detected` entries in `passwordResetSecurityLogs`. A few are expected from lost responses; many from one account means investigate;
- `legacy_session_upgraded` log lines, which should decline to zero.

## 6. Close the legacy window (by `AUTH_LEGACY_BEARER_UNTIL`)

1. Unset `AUTH_LEGACY_BEARER_UNTIL`. The route then answers 410.
2. In a follow-up change, delete:
   - `pages/api/auth/session/upgrade.ts`;
   - `lib/legacy-bearer.js` and `lib/legacy-bearer.d.ts`;
   - the `migrateLegacyStorage` block in `hooks/useAuth.tsx`;
   - their tests;
   - `/auth/session/upgrade` from `SESSION_PROBE_URLS`.
3. Then `lib/token-core.js` JWT signing can go. `JWT_SECRET` remains required only if something else uses it (check first).
4. Remove `ALLOWED_ORIGINS` and `NEXT_PUBLIC_SOCKET_URL` from the dashboards and `render.yaml`.
