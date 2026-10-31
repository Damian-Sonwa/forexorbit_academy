# Environment variables (names only)

No value is given here. Secrets are set in the hosting dashboards or a shell, never in Git or chat.

## New

| Variable | Where | Required | Meaning |
|---|---|---|---|
| `APP_ORIGIN` | server (Render, and Vercel if it serves API routes), **at build time and at run time** | **production: yes** | The one canonical HTTPS origin of pages, API and sockets, for example `https://app.example.com`. It must have no path, no query and no credentials. `server.js` refuses to start in production without a valid value, and the Edge middleware refuses every state-changing API request. Outside production it may be unset: the local dev server origins are trusted. |
| `AUTH_LEGACY_BEARER_UNTIL` | server | no (default closed) | **Temporary.** An ISO date-time. Until then, `POST /api/auth/session/upgrade` exchanges a still-valid pre-4.5 token for a cookie session, once. It is ignored if later than `2027-01-31T00:00:00Z` (`LEGACY_BEARER_HARD_STOP`). Remove after the window. |

## Changed meaning

| Variable | Now |
|---|---|
| `JWT_SECRET` | Still required by `server.js`. Used only to verify pre-4.5 tokens during the legacy window. Keep it unchanged until the window ends: rotating it ends the upgrade path. |
| `ALLOWED_ORIGINS` | **No longer read.** CORS and CSRF trust only `APP_ORIGIN`. Remove it from the dashboards after release. |
| `NEXT_PUBLIC_SOCKET_URL` | **No longer read** by the browser; the socket uses the page origin. Remove it from `render.yaml` and the dashboards after release. |
| `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_URL` | Must be **unset** (or equal to `APP_ORIGIN`). A different origin would not receive the host-only cookie. |
| `PORT` | Outside production, decides the trusted local origins (`http://localhost:PORT`, `http://127.0.0.1:PORT`). |

## Unchanged

`MONGO_URI` / `MONGODB_URI`, `MONGODB_DB_NAME`, `APP_BASE_URL` (reset links), `RESEND_*`, `PAYSTACK_*`, `AGORA_*`, `AI_API_KEY`, `SHARED_RATE_LIMIT`, `TRUSTED_PROXY_HOPS`.

## Operator-only (index script, never on the app servers)

| Variable | Meaning |
|---|---|
| `CERTIFICATE_INDEX_MONGO_URI` | Privileged connection used by `scripts/session-indexes.js` (the same rules as `scripts/certificate-indexes.js`). Read from `--connection-file <path outside any Git repository>` or the shell. |

## Local and test

| Variable | Meaning |
|---|---|
| `ACCEPTANCE_MONGODB_URI`, `ACCEPTANCE_DB_NAME`, `ACCEPTANCE_ALLOW_REMOTE` | in the gitignored `.env.acceptance`, used by `scripts/acceptance/run.js` and `scripts/acceptance/sessions-e2e.js` |
