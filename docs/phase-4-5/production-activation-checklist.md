# Production activation checklist

Each box is an owner action or approval. Only the two ticked boxes are done. Local validation (see `implementation-report.md`) is not production readiness.

## Before deploying

- [x] Phase 4.5 local commit approved and made (local branch only; not pushed or merged).
- [x] Hosting layout decided: Option A, Render as `APP_ORIGIN` (`hosting-architecture.md`). Option B not approved.
- [ ] Redirect for the Vercel address to `APP_ORIGIN` (every path, permanent) prepared, to go live together with the Phase 4.5 deploy; or the Vercel project removed.
- [ ] Paystack webhook URL confirmed to point at `APP_ORIGIN`.
- [ ] Staging deployment with its own database passed `scripts/acceptance/sessions-e2e.js` and `scripts/acceptance/run.js`, or the manual checks below.
- [ ] Manual browser checks on staging, in Chrome, Firefox and Safari (desktop and iOS):
  - [ ] DevTools → Application → Cookies: `__Host-fo_session` with HttpOnly ✓, Secure ✓, SameSite Lax, no Domain.
  - [ ] Console: `document.cookie` does not contain `fo_session`; `localStorage` has no `token` or `user`.
  - [ ] Reload keeps you signed in. Two tabs: sign out in one and the other goes to sign-in.
  - [ ] Lesson chat and community rooms connect (socket); sign out elsewhere disconnects them.
  - [ ] Password change keeps this tab signed in and signs out another browser.
  - [ ] Super Admin suspends a test student; the student's open tab is signed out within 30 seconds.
- [ ] Atlas backup or snapshot confirmed.
- [ ] `scripts/session-indexes.js` read-only on `Forex_elearning`, then `--apply` (privileged account, connection file outside Git); states `present` ×3.
- [ ] `forexorbitAppRole` given `find, insert, update(, remove)` on `Forex_elearning.sessions`; `scripts/check-db-role.js` passes.
- [ ] `APP_ORIGIN` set (build and run time) on every service that serves pages or API.
- [ ] `AUTH_LEGACY_BEARER_UNTIL` set to the agreed date (before 2027-01-31).
- [ ] `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SOCKET_URL` unset or equal to `APP_ORIGIN`; rebuild planned.
- [ ] `JWT_SECRET` unchanged.

## Release

- [ ] Deploy. The server log shows `Trusted origins: <APP_ORIGIN>`. It must not say `none`.
- [ ] Sign in as each role once: Super Admin, Admin, instructor, student.
- [ ] Super Admin approves a pending test registration; an Admin attempt is refused (403).
- [ ] `/api/auth/me` from another origin gets no `Access-Control-Allow-Origin`.
- [ ] A POST without `X-FO-CSRF` gets 403 `csrf_header_missing`.

## After release

- [ ] Day 1–3: login 500s = 0; few `origin_*` 403s; no unexplained `session_reuse_detected` bursts.
- [ ] `legacy_session_upgraded` declines.
- [ ] At the window's end: `AUTH_LEGACY_BEARER_UNTIL` removed; follow-up change deletes the legacy code (`rollout-plan.md` §6).
- [ ] `ALLOWED_ORIGINS`, `NEXT_PUBLIC_SOCKET_URL` removed from dashboards and `render.yaml`.

## Stop conditions (roll back, `rollback-plan.md`)

- Sign-in fails for a meaningful share of users and the cause is not a quick configuration fix.
- Sockets cannot connect in the chosen layout.
- Any sign that a session works from an origin other than `APP_ORIGIN`.
