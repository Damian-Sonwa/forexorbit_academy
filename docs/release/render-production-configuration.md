# Render production configuration

Approved architecture: the existing Render Web Service serves the whole application (pages, API, WebSockets) from one origin, `https://forexorbit-academy.onrender.com`. No new service, no static site, no proxy.

Values marked **(repo)** come from the repository. Values marked **(dashboard)** must be confirmed in the Render Dashboard, because this workspace has no Render access. Where they differ, the dashboard is what runs; this guide states which value the release needs.

## What the application actually is (correction to the brief)

ForexOrbit is **not** a React SPA served by Express. It is a **Next.js 15 (Pages Router) application** run by a **custom Node HTTP server**, `server.js`:

- `server.js` creates a plain `http` server. It hands every request to Next.js (`app.getRequestHandler()`) and attaches **Socket.IO** to the same server at path `/api/socket`. There is no Express.
- Next.js renders the pages, serves its own static assets (`/_next/static/*`, `public/`), runs the API routes (`pages/api/*`) and runs `middleware.ts`.
- **Build output** is `.next/`, produced by `next build`. There is no `build/` or `dist/` folder and no static-file middleware to configure.
- **Routing:** each page is a real route; there is no SPA fallback. A direct load or refresh of a nested route is rendered by Next.js. Live check on Render: `GET /courses/<id>/lessons/<id>` returns 200 HTML.
- **Missing API endpoints** get a real **404**, never `index.html` with 200. Live check on Render: `GET /api/definitely-missing-route` returns 404.
- **WebSockets:** Socket.IO intercepts `/api/socket` (polling and the WebSocket upgrade) on the HTTP server before Next.js sees the request. Live check on Render: the WebSocket upgrade opens and reaches the server's authentication step.

**No code change is needed for single-origin hosting.** The live Render build already references no other origin.

## A. Service identification

| Setting | Value |
|---|---|
| Service type | Web Service, runtime Node **(repo, `render.yaml`)** |
| Service name | `render.yaml` says `forex-elearning-app`, but the live host is `forexorbit-academy.onrender.com`, which suggests the dashboard service is named `forexorbit-academy`. **Use the existing service; confirm its name in the dashboard.** Do not create a new one. |
| Repository | `https://github.com/Damian-Sonwa/forexorbit_academy` **(repo remote)** |
| Branch | `master`. Render redeployed within minutes of pushes to `master` on 28 October (`docs/audits/release-readiness-2026-10-26.md`). **Confirm in the dashboard.** |
| Root Directory | **empty** (repository root; `package.json`, `server.js` and `next.config.js` are at the root) |
| Auto-Deploy | `render.yaml`: on. **Important:** a push or merge to `master` deploys at once. See the runbook. |

## B. Build and deploy

| Setting | Value |
|---|---|
| Build Command | `npm install && npm run build` **(repo, `render.yaml`)**. `npm run build` is `next build`: it compiles the pages, API routes and middleware into `.next/`. `server.js` needs no compilation. |
| Start Command | `npm start` **(repo)**. That runs `node scripts/start-production.js`, which sets `NODE_ENV=production` and loads `server.js`. That process serves pages, API and Socket.IO. |
| Health Check Path | **`/api/health`** (owner decision). Verified on the release build in production mode: `GET` returns 200 in about 15 ms once warm (about 0.5 s on the first call); no database call, no Origin or CSRF requirement, `Cache-Control: no-store`. It returns 503 if `MONGO_URI` or `JWT_SECRET` is missing. `HEAD` returns 405, but Render checks with `GET`. **Limit:** it shows the process is up and configured, **not** that Atlas is reachable; it stayed 200 with an unreachable database. Do not use `?deep=1` as the health check: it pings the database and could fail the check during an Atlas blip. |
| Node.js version | **`NODE_VERSION=22.19.0`** (owner decision), set as an environment variable on the service. The repository pins no version (no `engines`, `.nvmrc` or `.node-version`); all validation, including the release build, ran on Node 22.19.0; `next@15.5` and `resend` both support it. |
| Pre-deploy command | none |

Render's build environment must still install the build tools. `next build` uses `typescript`, `tailwindcss`, `postcss` and `autoprefixer`, which are devDependencies. The current production builds succeed, so the dashboard's current install behaviour is adequate. **Do not change the build command or `NODE_ENV` handling for this release.**

## C. Request routing on the one origin

| Path | Served by | Notes |
|---|---|---|
| `/`, `/login`, `/courses/...`, all pages | Next.js | Server-rendered or static per page; a refresh works on any route |
| `/_next/static/*`, `/images/*`, `/manifest.json`, `/service-worker.js` | Next.js static files | Hashed assets are cacheable; the service worker never caches `/api/*` |
| `/api/*` | Next.js API routes, through `middleware.ts` | The CSRF and Origin gate applies to every state-changing request. The exception is `/api/paystack/webhook`, which is signature-checked instead. |
| `/api/socket` (`?EIO=4&transport=polling` and the WebSocket upgrade) | Socket.IO in `server.js` | The Origin must equal `APP_ORIGIN`; the session cookie is required |
| unknown `/api/...` | Next.js 404 | Never the HTML of a page with status 200 |

## D. Runtime behaviour on Render

- **Port:** `server.js` listens on `process.env.PORT`. `render.yaml` sets `PORT=3000`; if the dashboard does not set it, Render supplies its own value. Either works, because the server reads whatever is set.
- **Interface:** in production `server.js` binds to `0.0.0.0` (see `server.js` line 65).
- **Health check:** see section B. Render routes traffic to a new deploy only after its health check passes.
- **Restarts and deploys:**
  - Sessions live in MongoDB, so they survive restarts and deploys.
  - Open Socket.IO connections drop when the old process stops; the client reconnects (up to 5 attempts, 1–5 s apart).
  - Users stay signed in.
- **Startup refusal:** in production the server exits with `APP_ORIGIN is not set` (or `must use https`) if `APP_ORIGIN` is missing or invalid. The deploy then fails its health check and the previous deploy keeps serving.
- **Multiple instances:** today there is one instance (plan `starter` in `render.yaml`; confirm in the dashboard).
  - HTTP sessions work across instances, because they are stored in MongoDB.
  - Socket.IO would need sticky sessions for its polling transport, or a shared adapter (for example Redis) to send events to sockets on other instances. Render does not provide sticky sessions.
  - **Stay on one instance** unless that work is done.

## E. Environment variables

See `production-environment-variables.md`.
