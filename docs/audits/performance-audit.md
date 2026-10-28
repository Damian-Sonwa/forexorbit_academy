# Forex Orbit Academy performance audit

Date: 27 October 2026. Branch `review/sprint-1-3-integration` at `fd23de2`, plus the local changes in this audit. Working tree before the audit was clean except untracked `template/`. That folder was not modified.

No commit, push, merge, deploy, or production database write was performed. The running development server on port 3000 was not stopped. `next build` was not run, because it writes `.next` while that server is using it.

## Architecture

Measured from the repository, not assumed.

- Next.js 15.5.28 Pages Router, React 18.2, TypeScript 5.9, Tailwind 3.3. Node v22.19.0 on the measurement machine.
- One Node process serves pages and APIs: `npm run dev` and `npm start` both run `server.js`. Socket.IO is attached there at `/api/socket`.
- Data store is MongoDB through the official driver (`db/mongoClient.ts`, `lib/mongodb.ts`). There is no Prisma and no Redis.
- Authentication is a JWT plus a live `users` read in `withAuth`. The token role is not trusted.
- Production is split. The page is also deployed on Vercel. API calls and the socket are aimed at `https://forexorbit-academy.onrender.com` when those public env vars are set. Required server env names are `MONGO_URI` or `MONGODB_URI`, and `JWT_SECRET`. Values were not printed.

## How this was measured

Tool: `curl.exe` on Windows, no browser throttle, no Lighthouse. Each line is one sample. Times are curl `time_starttransfer` (TTFB) and `time_total`.

Local target: `http://localhost:3000` (an already running `node server.js`). Production targets: Render and Vercel, read-only GET.

LCP, INP, and CLS were not measured. There was no browser performance trace. Those rows stay unverified.

Database explain plans and Atlas profiler output were not available. Query-count findings below are from source, except the one unauthenticated course-list timing.

## Baselines

### Local development

| Request | Samples | Result |
| --- | --- | --- |
| `GET /api/health` first | 1 | HTTP 200, TTFB 1.44s, 238 bytes. This route does not touch Mongo. |
| `GET /` first | 1 | HTTP 200, TTFB 1.64s, 22,563 bytes |
| `GET /api/courses` | 1 | HTTP 200, TTFB 0.40s, 2,241 bytes, no auth token |
| `GET /api/health` warm | 2 | TTFB 0.77s then 0.36s |
| `GET /` warm | 2 | TTFB 0.85s then 0.61s |
| `GET /images/smd.png` | 1 | HTTP 200, total 1.10s, 1,617,805 bytes |
| `GET /images/financial-learning-dashboard-devices.png` | 1 | HTTP 200, total 0.37s, 1,885,975 bytes |

The first local hits include on-demand compilation. Warm HTML is still about 0.6–0.8s. A trivial health handler is still about 0.36s when warm, so a large share of local latency is the custom development server, not a single database query.

A second `npm run dev`, started from the `server` directory, connected to Mongo, checked the three community rooms, closed that extra client, and then failed with `EADDRINUSE` on `::1:3000`. The process that already owned the port was left running. Startup therefore does a separate Mongo connection and three room lookups before `listen`, and a duplicate dev process repeats that work and then crashes.

### Production

| Request | Samples | Result |
| --- | --- | --- |
| Render `GET /api/health` | 3 | TTFB 34.01s, then 0.83s, then 0.67s. HTTP 200, 237 bytes. DNS 0.01–0.16s. TLS about 0.33–0.48s. |
| Render `GET /` | 2 | TTFB 0.69s and 0.66s. HTML 22,745 bytes. |
| Vercel `GET /` | 2 | TTFB 1.73s then 0.46s. HTML 22,745 bytes. |
| Render `GET /images/smd.png` | 1 | total 2.16s, TTFB 0.96s, 1,617,805 bytes |
| Vercel `GET /images/smd.png` | 1 | total 1.36s, TTFB 0.57s, 1,617,805 bytes |

Fact: the first Render health check took 34 seconds and the next two took under a second. That pattern matches a sleeping service waking up. It is not explained by the 237-byte handler, which does not ping Mongo.

Fact: after the process is warm, Render HTML TTFB is about 0.7s and Vercel HTML TTFB fell to 0.46s. Hypothesis: the remaining warm time includes geographic distance to the host and the Node server. It was not broken down further.

## Confirmed bottlenecks

1. **Render cold start.** First production health TTFB 34.01s, then 0.67–0.83s. Largest production delay in this sample. Hosting behavior. Room seeding also runs a second Mongo client before `listen`, which adds work during wake-up. The seed was not separately timed.

2. **Landing images.** `smd.png` is 1,617,805 bytes and was the hero. `financial-learning-dashboard-devices.png` is 1,885,975 bytes and sits below the fold. Both are 1536×1024. Local transfer of the hero PNG took 1.10s.

3. **Lesson reads loaded the same lessons more than once.** `GET /api/lessons` and `GET /api/courses/[id]` loaded every lesson document, then `buildSimpleLessonsWithLocked` loaded them again. `hasPaidForCourse` could load the lesson ids a third time. The dashboard then called the full lesson route once per in-progress course, one after another, only to read id, title, and order. Authenticated timing was not captured. The duplicate reads are in the source.

4. **Signed-in course list did one progress query per course.** `pages/api/courses/index.ts` called `progress.findOne` inside the course loop. The unauthenticated list, which skips that loop, returned 2,241 bytes in 0.40s locally. The signed-in path was not timed.

5. **One Socket.IO connection per `useSocket()` call, plus a 3-second broadcast.** Header, lesson pages, the practice desk, and other screens each called the hook, and each call opened a connection. `server.js` emitted a generated market signal to every connected socket every 3 seconds, including pages that do not show the chart.

6. **Session refresh blocked the first paint.** `useAuth` kept `loading` true until `GET /auth/me` returned, so dashboard and other signed-in pages waited on that round trip before rendering the cached user. On the split host that call goes to Render.

## Changes

Authorization, enrollment checks, and payment lock rules were kept. No index was created. No cache of private learner data was added.

| Change | Why |
| --- | --- |
| `server.js` starts `seedRooms()` without awaiting it | The port can open without waiting for the extra Mongo client. Seed errors are still logged. |
| Market signals go to the `market-signals` room | `MarketSignal` subscribes while mounted. Other pages no longer receive the 3-second event. |
| `SocketProvider` in `pages/_app.tsx` | One socket for the signed-in session. `useSocket()` reads that context. The token handshake is unchanged. |
| Course list uses one `progress.find` and a field projection | Removes the per-course enrollment query. Response fields stay the allowlisted course fields. |
| Lesson list and course detail pass the lessons they already loaded into the lock helper | Removes the second full lesson read. `hasPaidForCourse` can use those ids and skip a third lesson scan. |
| `GET /api/lessons?outline=1` projects title, type, order, course id, and required level | Dashboard continuation no longer downloads lesson bodies. Catalog access checks still run. |
| Dashboard loads those outlines with `Promise.all` | Removes the sequential wait across in-progress courses. |
| Cached user is shown before `/auth/me` returns | The page can render while the live record is refreshed. A failed refresh still logs the user out. APIs still check the token and the live user. |
| Hero and study images are WebP, hero is `fetchPriority="high"`, study image is `loading="lazy"` | Cuts the two large transfers. Original PNGs remain on disk. |
| `Cache-Control` on `/images/:path*` is `public, max-age=86400, stale-while-revalidate=604800` | Browser and CDN can reuse images for a day. Names are not content-hashed, so a replaced file can stay stale until that window ends. |

## After

| Check | Result |
| --- | --- |
| Local `GET /images/smd.webp` | HTTP 200, total 0.28s, 104,830 bytes. PNG was 1,617,805 bytes and 1.10s. |
| Local `GET /images/financial-learning-dashboard-devices.webp` | HTTP 200, total 0.29s, 148,850 bytes. PNG was 1,885,975 bytes and 0.37s. |
| `npx tsc --noEmit` | Exit 0, after the final lesson-query edit. |
| `npm test` | 218 passed, 0 failed. Includes `tests/performance-hot-paths.test.js`. |
| `npx next lint` on the edited files | Exit 0. Existing warnings only (`no-explicit-any`, `@next/next/no-img-element`). |
| `next build` | Not run. A dev server is using `.next`. |
| Authenticated API latency, dashboard navigation, socket count, production WebP, production cold start after the seed change | Unverified. The running server and the production deploy do not have these edits. |

## Measurement table

| Area | Baseline | Finding | Action | After optimization |
| --- | --- | --- | --- | --- |
| Development startup | Duplicate `npm run dev` seeded rooms, then `EADDRINUSE` on port 3000. Seed awaited before `listen`. | Extra Mongo client on every boot, and a second process that cannot bind. | Seed is no longer awaited. The duplicate process was not stopped. | Unverified until the next start. |
| Recompilation | First local `/api/health` 1.44s and `/` 1.64s. Warm health 0.36–0.77s, warm `/` 0.61–0.85s. | First hit pays Next dev compilation. Warm custom-server responses stay hundreds of milliseconds. | No bundler change. | Not remeasured. The server was not restarted. |
| Initial page load | Render HTML TTFB 0.66–0.69s warm. Vercel 1.73s then 0.46s. First Render health 34.01s. | Cold start dominates the first production hit. Warm HTML is under a second. | Seed no longer blocks listen. Hosting sleep was not changed. | Production after: unverified. |
| API latency | Local unauthenticated `GET /api/courses` 0.40s, 2,241 bytes. Authenticated lesson and course paths not timed. | Signed-in course list queried progress once per course. Lesson routes loaded lessons twice. Dashboard called the full lesson route in series. | One progress query. Reused lesson documents. Outline query and parallel dashboard loads. | Live timing unverified. |
| Database | No profiler or explain output. | Source shows the duplicate lesson reads and the per-course progress reads above. Connection pool was not retuned. | Query count reduced in those handlers. No index created. | Unverified against Mongo. |
| Production Web Vitals | Unverified. No Lighthouse or browser trace. | Hero file was 1.6 MB, which is a likely LCP cost. Not scored. | Hero is now 105 KB WebP and prioritized. | Production LCP unverified. |
| Bundle and assets | Hero PNG 1,617,805 bytes, local total 1.10s. Study PNG 1,885,975 bytes. | Both illustrations were full-size PNGs. Study image is below the fold. | WebP at quality 78. Study image lazy-loaded. Image cache header added. | Local WebP: 104,830 bytes / 0.28s and 148,850 bytes / 0.29s. Production transfer unverified. |

## What was not changed

- Render instance size, spin-down, or region. The 34s first request is the main production constraint and needs a host setting or an always-on check, not another query tweak.
- Mongo indexes. No explain plan was captured, so no index was proposed as required.
- Redis or a public cache of dashboards, progress, consultations, or payments.
- `withAuth` still reads the live user on protected routes.
- `react-quill`, `recharts`, and `agora-rtc-sdk-ng` stay on the routes that already import them. They are not in `_app`.
- Production build. Do not run `next build` in this checkout until the dev server on port 3000 is stopped on purpose.

## Next actions, by impact

1. Let Render finish a deploy of this tree, then repeat the three-sample health and homepage timing and the hero image size. Expect the image bytes to drop. Do not expect the 34s cold start to disappear.
2. Decide whether Render may sleep. If the first request must stay under a second, the service has to stay awake. That is a hosting change, not a code change.
3. Restart the local server once, on purpose, and time boot until `listen` and a warm `GET /api/health`. The current process does not include the seed change.
4. With an authenticated local session, time `GET /api/courses`, `GET /api/lessons?courseId=&outline=1`, and dashboard load. Compare outline payload size with the full lesson list.
5. Run a browser trace for LCP on `/` and INP on the dashboard. Curl cannot supply those numbers.
