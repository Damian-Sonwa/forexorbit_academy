# Hosting architecture for cookie sessions

Decision (owner, 31 October 2026): one canonical HTTPS origin for frontend, API and WebSockets. Option A (one service) is preferred if no infrastructure migration is needed. Option B (Vercel proxying to Render) is **not approved** unless WebSocket upgrade proxying is shown end to end.

Nothing here was changed in production: no hosting, routing, DNS or environment setting.

## Current layout (evidence, 31 October 2026)

**From the repository:**

- `render.yaml`: one Render web service runs `npm start` → `scripts/start-production.js` → `server.js`, which serves the Next.js pages, all `/api/*` routes and Socket.IO on `/api/socket`.
- `vercel.json`: Next.js on Vercel serverless functions. It has no rewrites or redirects. `VERCEL_DEPLOYMENT.md` states that Vercel cannot host Socket.IO.
- `docs/audits/release-readiness-2026-10-26.md`: both Render (`https://forexorbit-academy.onrender.com`) and Vercel (`https://forexorbit-academy.vercel.app`) deploy from `master`.
- `render.yaml` names `https://forex-elearning-app.onrender.com` in `NEXT_PUBLIC_SOCKET_URL`. That is not the host observed below; the dashboard value governs. With Phase 4.5 the variable is no longer read.

**Read-only, unauthenticated requests made from this workstation** (no sign-in, no writes):

| Request | Render | Vercel |
|---|---|---|
| `GET /` | 200, Next.js page (served through Cloudflare, Render request id present) | 200, Next.js page |
| `GET /api/health` | 200: database and JWT configured | **503**: database and JWT **not** configured, so Vercel's own API routes cannot serve users |
| `GET /api/socket/?EIO=4&transport=polling` | 200: Socket.IO handshake offering `"upgrades":["websocket"]` | 308 redirect (no Socket.IO server) |
| Socket.IO client, `transports: ['websocket']` only | the WebSocket opened and the server's auth middleware answered `Authentication error` (expected without a token), so **WebSocket upgrades work end to end through Render's edge** | `websocket error`: no WebSocket endpoint |
| JavaScript served by Vercel `/login` | n/a | references `https://forexorbit-academy.onrender.com`: the Vercel frontend calls the Render API and sockets **cross-origin** |

## Why the current Vercel → Render layout cannot carry cookie sessions

- The session cookie is `__Host-` (host-only) and `SameSite=Lax`. A page on `forexorbit-academy.vercel.app` calling `forexorbit-academy.onrender.com` makes cross-site requests. The browser would not send the cookie on those requests, and Safari and Firefox block such third-party cookies anyway.
- The CSRF and CORS rules trust only `APP_ORIGIN`, so requests from the Vercel origin are refused. This is intended: the old wildcard `*.vercel.app` trust is exactly what Phase 4.5 removes.

## Recommendation: Option A, Render as the canonical origin

`APP_ORIGIN=https://forexorbit-academy.onrender.com`, or a custom domain attached to the same Render service (for example `https://app.<domain>`), which can be added later.

- **No infrastructure migration:** the Render service already serves pages, API and WebSockets, and is the only deployment with a configured API.
- **Exact routing requirements:**
  - Render serves `/`, `/_next/*`, `/api/*` and `/api/socket/*` (Socket.IO, polling and WebSocket) on that one origin. This is already true.
  - `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` unset on Render (or equal to `APP_ORIGIN`), then a rebuild.
  - The Vercel address must stop being an entry point: a permanent redirect of every path to the same path on `APP_ORIGIN` (a `redirects` entry in `vercel.json` or the Vercel dashboard), or the Vercel project removed. **Not done; owner action at release.** Until then, users who open the Vercel address will be unable to sign in after Phase 4.5 deploys.
  - Paystack's webhook URL must point at `APP_ORIGIN` (Render already returns 401 for unsigned calls; Vercel has no payment keys).
- **Limitations:**
  - One Render instance carries all traffic. Pages lose Vercel's CDN for HTML; `/_next/static` assets are still cacheable at Render's edge.
  - Scaling Render to more than one instance later needs sticky sessions or a Socket.IO adapter (for example Redis) for sockets. HTTP sessions already work across instances because they live in MongoDB.
  - A Render deploy restarts the process: sockets reconnect and sessions survive (database-backed).
- **Cost and operations:**
  - Render plan per `render.yaml` is `starter`, an always-on instance with no extra service needed.
  - Vercel can drop to a redirect-only project (no functions run) or be removed.
  - Owner checks: Render instance size under full page traffic, and the Render bandwidth allowance.
- **Rollback:** see `rollback-plan.md`. Hosting-wise, removing the Vercel redirect restores the old entry point. That only works with the pre-4.5 code, because the 4.5 code refuses that origin.

## Option B: not approved, not configured

Vercel as the origin with `/api/*` and `/api/socket/*` rewritten to Render. It was **not demonstrated**:

- no rewrite exists, and none was created;
- Vercel's documentation describes external rewrites as HTTP proxying, and the probes above show no WebSocket endpoint on Vercel today.

Socket.IO over a proxied long-polling transport might work, but it would need `transports: ['polling', 'websocket']` in `hooks/useSocket.ts`, an end-to-end WebSocket proof on a staging Vercel project, and a separate approval. It also keeps two deployments to operate.
