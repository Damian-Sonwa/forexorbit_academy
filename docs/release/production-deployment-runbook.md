# Production deployment runbook (Phase 4, Phase 4.5 and the learning-level fix)

Every step that changes production is an **owner action** and needs explicit approval at the time it is carried out. Nothing in this runbook has been executed.

## Facts this plan relies on (31 October 2026)

**Git:**

- `origin/master` is `d7e0d1d`, the last released code. It is an ancestor of `f3e728a` → `7dca2c8`, so the release can **fast-forward** `master`.
- The learning-level fix `d14a756` sits on `f3e728a`. Combining it with `7dca2c8` conflicts only in the `package.json` test line (keep both test files). That combination was validated locally: 754/754 tests, tsc, build, acceptance 77/77.
- The four extra commits on `review/sprint-1-3-integration` change documentation only.

**Hosting:**

- **Render and Vercel both auto-deploy from `master`.** A push to `master` rebuilds both.
- The current Render build is same-origin: it references no other host, and pages, API and Socket.IO all work on `https://forexorbit-academy.onrender.com`.
- The current Vercel build calls the Render API **cross-origin**. Vercel's own API is not configured.

**Consequence:**

- Once Render runs Phase 4.5, **no Vercel-served frontend can work**:
  - the old bundle sends bearer tokens, which are now refused;
  - a new bundle cannot carry the host-only cookie across sites.
- So the Vercel address must send people to Render **no later than** the moment Render switches to Phase 4.5.
- Because the current Render site already works on its own, users can safely be moved to Render **before** the 4.5 deploy (stage 2). Owner decision D5.

## Stage 0: approvals

Record the owner's decisions D1–D6 (`production-readiness-report.md`) before starting.

## Stage 1: prepare the release (local, then push on approval)

1. **Release branch: done (local).** `release/phase-4-5` in worktree `forexorbit_academy-release-phase-4-5`: `f3e728a` → `7dca2c8` → `2f9e5ef` (cherry-pick `-x` of `d14a756`, content identical) → the documentation commit. Validated on this branch: 754/754 tests, tsc, build, acceptance (`production-readiness-report.md`). The branch is not pushed.
2. **Vercel redirect commit: prepared (local).** Branch `release/vercel-redirect`, commit `3a97fd5`, parent `d7e0d1d`. It only adds this block to `vercel.json`:
   ```json
   "redirects": [
     { "source": "/:path*", "destination": "https://forexorbit-academy.onrender.com/:path*", "permanent": false }
   ]
   ```
   - `permanent: false` gives a 307 that browsers do not cache, so it can be undone (see the rollback runbook).
   - Render ignores `vercel.json`.
3. **Staging:** a temporary Render Web Service with a separate staging database (D2; set-up in `staging-validation-checklist.md`). Render builds from a GitHub branch, so staging needs `release/phase-4-5` **pushed to GitHub as its own branch** (not `master`), which needs owner approval. Complete the checklist; do not continue until it is signed off.

## Stage 2: move users to the Render origin (recommended before the 4.5 deploy; D5)

1. Fast-forward `master` from `d7e0d1d` to `3a97fd5` (`release/vercel-redirect`) and push. This needs approval.
   - Render rebuilds the same application code: no functional change.
   - Vercel becomes a redirect.
2. Check:
   - `https://forexorbit-academy.vercel.app/courses` answers 307 to the same path on Render;
   - signing in, a lesson and a socket feature work on the Render origin.
3. People signed in on Vercel sign in once more on Render: browser storage is per origin.
4. Leave this running for at least a day before stage 4 if the owner wants the legacy exchange to be useful (D3). That gives users time to hold pre-4.5 sessions on the Render origin.

## Stage 3: production database (owner, privileged account; `production-database-preparation.md`)

1. Confirm a current Atlas backup or snapshot.
2. Run `scripts/session-indexes.js` read-only. Expected: target `Forex_elearning.sessions`, with S1, S2 and S3 `missing`.
3. Run with `--apply`. Expected: `Built: session_user, session_family, session_ttl`. This creates the collection.
4. Read-only again: `present` ×3.
5. Atlas: add `find, insert, update, remove` on `Forex_elearning.sessions` to `forexorbitAppRole`.
6. Run `node scripts/check-db-role.js --database Forex_elearning` from the release branch, as the app user. Expected: `PASS`.

The old code ignores the `sessions` collection, so this stage is safe while the current release still serves users.

## Stage 4: Render environment (owner; `production-environment-variables.md`)

1. Make these changes:
   - Add `APP_ORIGIN=https://forexorbit-academy.onrender.com`.
   - Add `NODE_VERSION=22.19.0` (D6).
   - Set the Health Check Path to `/api/health` (Settings → Health Checks; D6).
   - Update `APP_BASE_URL=https://forexorbit-academy.onrender.com`.
   - Confirm `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` are unset, or equal to `APP_ORIGIN`.
   - Keep `JWT_SECRET`, `MONGO_URI` and the provider keys unchanged.
   - `AUTH_LEGACY_BEARER_UNTIL`: **leave unset** (D3: exchange disabled).
2. Saving restarts the **current** release. It ignores these settings, apart from using the new `APP_BASE_URL` in reset emails, which is correct after stage 2. Check that the site still works.

## Stage 5: Paystack (owner)

In Paystack → Settings → API Keys & Webhooks (Live), set the webhook URL to:

`https://forexorbit-academy.onrender.com/api/paystack/webhook`

- Checkout uses the inline popup, so there is no callback URL to change.
- Today an unsigned call to Render's webhook returns 401 (a live key is configured there). Vercel has no payment keys and returns 503.
- If the dashboard currently points at Vercel, change it here, in stage 5.

## Stage 6: deploy

1. Bring the redirect into the release without rewriting any accepted commit: on `release/phase-4-5` run `git merge --no-ff master`.
   - That makes **one merge commit**. It merges cleanly: the release never touches `vercel.json`, checked with `git merge-tree`.
   - Run `npm test` and `npm run build` again.
   - Then fast-forward `master` to that merge commit and push. **This needs approval (D1).**
   - Render builds and deploys the release.
   - Vercel rebuilds and stays a redirect.
2. Watch the Render deploy log. Expect `✓ Trusted origins: https://forexorbit-academy.onrender.com` and `Server is ready`. A message `APP_ORIGIN is not set` means stage 4 is missing; the previous deploy keeps serving.
3. The health check (`/` or `/api/health`) passes.

## Stage 7: verify production (immediately)

| Check | Expected |
|---|---|
| Home, `/login`, a nested course URL with a refresh | pages load |
| Sign in as Super Admin, Admin, instructor and student | each lands on its dashboard; cookie `__Host-fo_session` is HttpOnly and Secure |
| `document.cookie` and `localStorage` in the console | no session, no `token` |
| `curl -s -o /dev/null -w "%{http_code}" -X POST https://forexorbit-academy.onrender.com/api/auth/login -H "Content-Type: application/json" -d "{}"` | `403` (no Origin or CSRF header) |
| `curl -si -H "Origin: https://forexorbit-academy.vercel.app" https://forexorbit-academy.onrender.com/api/auth/me` | no `Access-Control-Allow-Origin` |
| Lesson chat or community room | the socket connects (DevTools: 101) |
| Sign out in one tab | the other tab returns to sign-in |
| Admin opens approvals | 403; Super Admin can approve |
| Catalogue, a lesson, progress | work; levels advance with published courses only |
| Staff certificate issue | works; a duplicate is refused |
| Unsigned `POST /api/paystack/webhook` | 401 |
| A real checkout | **only if the owner chooses to make one**; otherwise wait for the next real payment and check the webhook log |
| Password-reset email | **only to an owner-controlled address**; the link opens on the Render origin |
| `https://forexorbit-academy.vercel.app/...` | 307 to Render |

## Stage 8: monitor (first 72 hours)

Watch the Render logs and Atlas for:

- login 500s, which point to the role (fix stage 3);
- many `403 origin_*` or `csrf_header_missing` responses, which point to a client issue or a wrong `APP_ORIGIN`;
- `socketOrigin refused`;
- `session_reuse_detected` entries in `passwordResetSecurityLogs`: occasional entries are normal, bursts are not;
- `legacy_session_upgraded` (only if D3 opened the exchange);
- webhook errors;
- Atlas: `sessions` growth levels off after about 36 hours, when TTL deletions start.

## Stage 9: follow-ups

1. After 7 days without a rollback, consider making the Vercel redirect permanent (308), or retire Vercel's production use. Vercel preview deployments of `master` also redirect.
2. Close the legacy exchange: unset `AUTH_LEGACY_BEARER_UNTIL` at its date. Then remove the bridge code in a follow-up change (`docs/phase-4-5/rollout-plan.md` §6), at the latest before 31 January 2027.
3. Remove `ALLOWED_ORIGINS` and `NEXT_PUBLIC_SOCKET_URL` from the Render settings and `render.yaml`.
4. If the index grant was temporary (stage 3, D4), remove it.
