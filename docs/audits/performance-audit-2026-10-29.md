# Performance audit and optimization — 29 October 2026

Scope: the whole application (Next.js 15.5 pages router, React 18, custom `server.js` with Socket.IO, MongoDB driver 6, Axios client, Tailwind). Roles: student, instructor, admin, Super Admin. Base commit `139b8fd` (current `master`). All changes are uncommitted in the working tree.

## How it was measured

| What | Method | Environment |
|---|---|---|
| JavaScript per page | `next build` route table (gzipped "First Load JS") | This container, before and after |
| Page loads | Playwright (Chromium) against a local **production** build (`NODE_ENV=production node server.js`). The browser's `/api` calls were answered from fixtures built with the repository's seed builders, each with a fixed 40 ms delay. 12 journeys across all four roles, 2 runs each (median), two profiles: unthrottled and "slow 4G" (1.6 Mbit/s down, 150 ms RTT, 4× CPU slowdown). Each page was then left idle for 20 s to count background requests. | Lab only |
| Database queries per request | Handlers run against an instrumented in-memory collection that records every query (tests) | Unit level |
| Refetch loop | Playwright probe: open the practice desk's "Practice account" tab, count API calls for 10 s | Lab only |

**Not measured** (no database, production or monitoring access in this environment): real API latency, real MongoDB query durations and plans, production Core Web Vitals from real users, Render cold starts. Fonts and other third-party hosts were blocked in the lab, so font loading was not measured. Timings below are lab measurements, not field data.

## Root causes found (by severity)

| # | Severity | Finding | Evidence | Scope |
|---|---|---|---|---|
| 1 | **Critical (functional)** | Lesson pages never leave their loading skeleton. `useLesson` returned early on 200/403/404 before `setLoading(false)` (regression from commit `786313e`, now on `master`). | Screenshot: baseline lesson page stays on the skeleton. New test fails 3/4 cases against the old hook. | Every lesson, every student |
| 2 | **Critical** | Practice desk "Practice account" tab refetches in an infinite loop: the effect depended on `account`, and each load set a new `account` object. | Probe: **213–214 calls each** to `/api/demo-trading/account`, `/trades`, `/performance` in 10 s (~64 req/s); each can also call the broker API. | Students with a demo account |
| 3 | **High** | A Node crypto polyfill was shipped to every page: `lib/public-error.js` (imported by the API client) did `require('crypto')` only to make request ids. | `_app` chunk 169 kB gzipped, containing `secp256k1`, `sha512`, 330 `Buffer` refs. Shared JS 268 kB on every page, including login. | All pages, all roles |
| 4 | **High** | Sidebar polled `/api/auth/me` every 5 s and on every focus, on top of `AuthProvider`'s own read. Each call is 2 DB reads. | 4 extra calls per 20 s idle on every signed-in page; `/api/auth/me` ×7 in a page's first 60 calls. | All signed-in pages |
| 5 | **High** | Every signed-in page loaded its data twice: `AuthProvider` replaced `user` with an equal but new object after `/api/auth/me`, and ~35 effects depend on `user`. | Every data endpoint appeared ×2 during load (e.g. admin: 22 calls on load, 11 unique). | All signed-in pages |
| 6 | **High** | `recharts` (~100 kB gz) bundled into pages that rarely show charts: the lesson page and practice desk (through `MarketSignal`) and the whole admin page (charts only on the Analytics tab). | `/admin` 402 kB, lesson 394 kB, practice desk 400 kB first-load JS. | Admin, students |
| 7 | **Medium** | `GET /api/progress` ran 3 queries per enrollment and loaded every lesson document in full (including lesson HTML) just to count them. | Test: old code 181 queries for 60 enrollments; new code 4. | Dashboard, progress, course pages |
| 8 | **Medium** | No indexes on the learning collections (`progress`, `lessons`, `quizScores`, `notifications`, `demoTradeJournal`, …); only payment collections had any. Every dashboard and header query is a collection scan. | `lib/course-payment-indexes.js` is the only index definition; no other `createIndex` for these collections. | All roles, grows with data |
| 9 | **Medium** | N+1 lookups: practice-desk tasks (1 user lookup per task), journal (1 task lookup per entry), leaderboard non-default views (up to 100 user lookups). Default leaderboard read whole student documents for four fields. | Code review; batched helper tested. | Students, instructors |
| 10 | **Medium (functional)** | Inter and Poppins never loaded: the Google Fonts `@import` ended up after other rules in the built CSS, where browsers ignore it. | Built CSS; no font link in `_document`. | All pages (typography) |
| 11 | **Low** | Two MongoDB clients (and pools) per production process: one for `server.js`, one for the API routes. | `db/mongoClient.ts` and `lib/mongodb.js` only shared a client in development. | Server |
| 12 | **Low** | `_document` linked `/favicon.ico`, which does not exist (a 404 on every page load). | `public/` listing. | All pages |

Also observed, not changed (outside performance or behavioural): the leaderboard returns other students' email addresses to any signed-in user; course search builds a regular expression from raw user input; Next.js prefetches every visible sidebar link's code (large transfer on dashboards, but it speeds up navigation).

## Changes

| Change | Files | Why it is safe | Tests |
|---|---|---|---|
| Fix lesson loading state (keep the 401 behaviour, restore `finally`) | `hooks/useLesson.ts` | Same outcomes; only the loading flag now clears on every non-401 result | `tests/lesson-loading.test.js` (4) |
| Stop the practice-account refetch loop: load once on mount; price refresh depends on whether an account exists | `components/TradingInterface.tsx` | Same data and 5-second price refresh while an account is connected | Probe: 639 → 3 calls in 10 s |
| Request ids from Web Crypto instead of `require('crypto')` | `lib/public-error.js` | Ids only correlate logs with support reports (not secrets); same 16-hex format; fallback for older Node | `tests/public-error.test.js` (existing) |
| One shared profile in `AuthProvider`: `refreshUser()`, throttled refresh on tab focus (≥ 60 s), no 5-second sidebar polling; keep `user` identity when `/auth/me` returns the same data | `hooks/useAuth.tsx`, `components/Sidebar.tsx`, `pages/profile.tsx` | Authorization is unchanged: every API request still checks the live user record in `withAuth`. Profile edits call `refreshUser()` so the sidebar updates immediately. | Lab: idle calls 32 → 0, load calls −44% |
| Lazy-load charts: `MarketSignal` on lesson and practice pages; admin charts moved to `components/admin/AdminAnalyticsCharts.tsx` and loaded with the Analytics tab | `pages/courses/[id]/lessons/[lessonId].tsx`, `pages/student-dashboard.tsx`, `pages/admin/index.tsx`, `components/admin/AdminAnalyticsCharts.tsx` | Same components; placeholders reserve space | Screenshots: charts and widget render |
| Batched `GET /api/progress` (4 queries regardless of enrollments; lesson ids only; course fields only) | `lib/progress-views.js`, `pages/api/progress/index.ts` | Output identical to the old code, same order, same per-user filters | `tests/progress-views.test.js` (5): equality with the old algorithm, query count, projections, isolation |
| Batched `_id` lookups with the old matching rules | `lib/batch-lookup.js`, `pages/api/demo-trading/tasks.ts`, `pages/api/demo-trading/journal.ts`, `pages/api/leaderboard/index.ts` | Same role checks and filters; names and titles resolved from one query. An invalid stored id now falls back to the default label instead of failing the whole request. | `tests/batch-lookup.test.js` (4) |
| Leaderboard reads only `name`, `email`, `points`, `avatar` | `pages/api/leaderboard/index.ts` | Response fields unchanged | — |
| One MongoDB client per process | `db/mongoClient.ts`, `lib/mongodb.js` | Same URI and database selection; one pool instead of two | Existing tests |
| Load fonts from `_document` with preconnect, only used weights (Inter 400–700, Poppins 500–700) | `pages/_document.tsx`, `styles/globals.css` | `display=swap`: text renders immediately in the fallback font | Not measurable here (third-party host blocked) |
| Favicon link points to an existing icon | `pages/_document.tsx` | — | — |
| Index plan and script (not run) | `lib/learning-indexes.js`, `scripts/learning-indexes.js` | Non-unique only; dry run by default; refuses on conflicts; rollback drops only its own indexes; leaves `{userId, courseId}` on `progress` for the planned unique index | `tests/learning-indexes.test.js` (7) |

Not changed: payment code and its tests (`lib/course-payment.js`, Paystack routes, the duplicate-reference fix), authentication and authorization checks, rate limits, API response shapes, database contents.

## Results

### JavaScript per page (gzipped First Load JS, `next build`)

| | Before | After |
|---|---|---|
| Shared by every page | 268 kB | **138 kB** |
| `_app` chunk | 169 kB | **38 kB** |
| Average over 42 pages | 286 kB | **148 kB (−48%)** |
| `/admin` | 402 kB | 161 kB |
| `/student-dashboard` | 400 kB | 167 kB |
| `/courses/[id]/lessons/[lessonId]` | 394 kB | 158 kB |
| `/login` | 262 kB | 132 kB |

### Lab page loads (median of 2 runs, same fixtures and settings)

| Journey | Profile | LCP ms | Load ms | JS transferred kB | API calls during load | API calls in 20 s idle |
|---|---|---|---|---|---|---|
| Home (public) | slow 4G | 2376 → 2180 | 2870 → 2099 | 596 → 358 | 2 → 2 | 0 → 0 |
| Courses (public) | slow 4G | 3524 → 2752 | 2406 → 1689 | 648 → 520 | 1 → 1 | 0 → 0 |
| Sign in | slow 4G | 2740 → 2352 | 2933 → 2533 | 426 → 189 | 0 → 0 | 0 → 0 |
| Student dashboard | slow 4G | 3228 → 2516 | 2036 → 1322 | 1932 → 988 | 11 → 7 | 4 → 0 |
| Student courses | slow 4G | 3152 → 2384 | 2431 → 1702 | 1885 → 1006 | 7 → 3 | 4 → 0 |
| Course detail | slow 4G | 3076 → 1920 | 2038 → 1337 | 1702 → 823 | 8 → 4 | 4 → 0 |
| Progress | slow 4G | 2264 → 1548 | 2026 → 1277 | 1717 → 838 | 7 → 3 | 4 → 0 |
| Practice desk | slow 4G | 3016 → 1696 | 2708 → 1386 | 917 → 688 | 10 → 5 | 4 → 0 |
| Instructor dashboard | slow 4G | 2340 → 1560 | 2125 → 1385 | 725 → 597 | 15 → 11 | 4 → 0 |
| Admin | slow 4G | 3068 → 1720 | 2709 → 1403 | 929 → 693 | 23 → 11 | 4 → 0 |
| Course purchases (Super Admin) | slow 4G | 2208 → 1480 | 2003 → 1293 | 1520 → 587 | 7 → 3 | 4 → 0 |

Totals over the 11 comparable slow-4G journeys and the lesson page: JS transferred 13,460 → 7,519 kB (−44%), API calls during load 96 → 54, idle API calls 32 → 0, summed LCP 32.4 s → 23.5 s (−27%). Unthrottled: JS −45%, same request reductions.

**Lesson page:** not comparable. The baseline never rendered a lesson (finding 1). After the fix it renders with LCP 2148 ms on slow 4G, 4 API calls during load and none while idle.

**Practice account tab:** 639 API calls in 10 s → 3.

### Database queries per request (counted with an instrumented collection)

| Endpoint | Before | After |
|---|---|---|
| `GET /api/progress`, 60 enrollments | 181 (and every lesson document in full) | **4** (lesson ids only) |
| `GET /api/demo-trading/tasks`, N tasks | 1 + N (student) / 1 + 2N (staff) | 2 |
| `GET /api/demo-trading/journal`, N entries | 1 + N | 2 |
| `GET /api/leaderboard` non-default types | 1 + up to 100 | 2 |
| `/api/auth/me` per signed-in user per minute (idle) | ~12 requests (24 DB reads) | ≤ 1 on tab focus |

## Verification

| Check | Result |
|---|---|
| `npm test` | **473 passed, 0 failed** (20 new tests in 5 files) |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npm run lint` | exit 0, 0 errors, 584 warnings (586 before) |
| `npm run build` | exit 0, 43/43 static pages |
| Functional screenshots (optimized build) | Admin Analytics charts render; Practice account tab renders after one fetch; lesson page renders with the lazy market widget; sidebar shows the profile from shared state |
| Payment tests | Unchanged and passing (duplicate reference, webhook, concurrency, ledger) |

## Recommended next steps

1. **Deploy soon:** finding 1 (lesson pages stuck loading) is live on `master`.
2. **Indexes (needs owner approval and production access):** run `node scripts/learning-indexes.js --database Forex_elearning` (read-only), then `--apply`. Test on the dev database first.
3. **Production monitoring:** enable MongoDB Atlas slow-query logging and the Performance Advisor, and watch Render response times; real latency and query plans could not be measured here.
4. **Further work:**
   - mount `Header`/`Sidebar` once in a shared layout (avoids a notifications refetch per navigation);
   - decide whether sidebar links should prefetch on hover only (less data on mobile);
   - fix the leaderboard email exposure;
   - escape the course search input;
   - consider merging `/student-dashboard` and `/demo-trading`.
