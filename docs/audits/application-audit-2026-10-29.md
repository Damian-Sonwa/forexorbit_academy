# ForexOrbit Academy: application audit and remediation (2026-10-29)

Branch `claude/intelligent-meitner-2qikrv`, starting from `ef720fa`. Nothing has been committed, pushed or deployed. No production data, indexes or environment variables were read or changed. No real payments were made.

## How it was verified

- **Unit and regression tests:** `npm test` runs 506 tests, all passing. 27 of them are new, in three files:
  - `checkout-termination` (10)
  - `lesson-outline-view` (7)
  - `audit-remediation` (10)
- **Static checks:** `tsc --noEmit` is clean. `next lint` reports 0 errors and 584 warnings, the same count as before this round. Of the 584, 583 predate this round; one new warning appeared and was fixed.
- **Production build:** `next build` succeeds. Shared first-load JavaScript stays at 138 kB.
- **Browser lab:** a local production build was run in Chromium with Playwright.
  - The `/api` and `js.paystack.co` requests were answered by fixtures. The fixtures are built from the repository's own seed data and response presenters.
  - The Paystack key was a placeholder (`pk_test_placeholder`). The database URI pointed at an unreachable local port, so no database was used.

Limits: lab results show behaviour, not production timings. There was no access to MongoDB, so query plans and real payload sizes are **not measured** (see "Blocked").

## Findings by severity

### High

**H1. Checkout could stay on "Working…" indefinitely.** Fixed and verified.
- *Reproduction:* stall or block `js.paystack.co`, click Unlock, then click it again after the failure.
- *Cause:* `loadPaystackInline` had no timeout. On retry it reused the earlier `<script>` tag and waited for `load`/`error` events that had already fired, so the promise never settled.
  - Even after the tag was replaced, Chromium handed the new tag the still-stalled request for the same URL.
  - Separately, the start-checkout and confirm requests had no timeout. A post-unlock page refresh that hung, or threw, also held the "Confirming…" state.
- *Fix:*
  - The script load is capped at 15 s, and a failed tag is removed.
  - Each retry requests a distinct URL (`?retry=n`).
  - Concurrent loads share one promise.
  - The start-checkout request is capped at 20 s, and each confirm request at 20 s.
  - The post-unlock refresh is bounded. If it fails, the unlock still stands and the user sees "Reload the page".
  - Server-side verification, webhooks, idempotency and entitlement are unchanged. The browser still never grants access itself.
- *Lab result:* every scenario reaches a terminal state:

  | Scenario | Outcome |
  |---|---|
  | Script stalls | Error at 15 s; retry opens Paystack |
  | Script blocked | Error at once; retry works |
  | Start-checkout stalls | Message at 20 s |
  | User cancels | Back to idle at once |
  | Paid and confirmed | Unlocked |
  | Server reports not paid | Failure message with reference |
  | Server unavailable (503) | Pending at 17 s |
  | Confirm requests stall | Pending at about 97 s (4 × 20 s plus retry delays) |

- *Tests:* `tests/checkout-termination.test.js`. The loader and refresh-hang tests fail when run against the previous code.

**H2. Course and lesson pages downloaded every lesson's full content, twice on the course page.** Fixed; lab-verified.
- *Cause:*
  - `/courses/:id` embedded the full lesson list with all teaching content, which neither of its callers used.
  - The page also loaded `/courses/:id/lessons`, again with full content, only to show titles, a blurb and lock state.
  - The lesson page loaded that same full list for its sidebar.
  - `readLessonDetail` loaded every sibling lesson document just to price one lesson.
  - Lesson bodies can be large: the API accepts 16 MB bodies, and rich-text images may be embedded inline.
- *Fix:*
  - Added `?lessons=none` on `/courses/:id`. It skips the lessons query and the entitlement lookup.
  - Added `?view=outline` on `/courses/:id/lessons`. It returns navigation fields and a 280-character plain-text blurb (`lib/lesson-outline-view.ts`).
  - The course page, lesson page and instructor course page now use these.
  - The sibling query in `readLessonDetail` now uses a projection (`_id`, `order`, `isFirstLesson`, `isDemo`).
  - Defaults are unchanged for any other caller. The read rule and paywall still apply wherever content is sent.
- *Evidence:*
  - In a test, an image-heavy lesson row (>400 kB) becomes an outline under 1 kB.
  - In the browser, the course page calls `?lessons=none` and `?view=outline`, and the lesson page calls `?view=outline`. Both render.
- *Not measured:* the real production saving depends on stored lesson sizes. There is no database access here.

**H3. Dark mode was inconsistent.** Fixed and verified.
- *Cause:* sections built on light hex colours (`.theme-light-island`) stayed light in dark mode:
  - sign-in and sign-up;
  - the whole community area;
  - the landing hero and portfolio;
  - How it works.
- Other contributors:
  - Admin and assignment charts used a white tooltip, a light grid and a near-black series.
  - `/forgot-password` and `/reset-password` were styled for dark only. In light mode their heading rendered white on white (contrast 1.0).
- *Fix:*
  - Those sections are now `.theme-section`. One remap block in `globals.css` maps their light colours to the dark tokens.
  - The orange-text exemption was removed.
  - Charts use `lib/chart-theme.ts`.
  - The password pages are light-first with `dark:` variants.
  - The auth logo now follows the theme.
- *Evidence:* a matrix of 39 routes across public, student, instructor, admin and super-admin views, each in both themes (78 page loads).
  - The correct theme class applied on all 78.
  - No forced-light surface remains in dark mode.
  - The remaining flags are intentional design elements: the dark footer in light mode, the About callout band, the video frame and the inverted secondary button.

### Medium

**M1. Theme toggle missing outside the app header.** Fixed and verified.
- Added a shared `components/ThemeToggle.tsx`, used in:
  - the app header;
  - the landing and How it works headers;
  - sign-in and sign-up.
- Every page renders one of these layouts.
- The icon follows the `.dark` class that is set before paint, so it is correct on first render. Theme changes now sync across tabs, and storage errors are handled.

**M2. Non-functional language switcher.** Removed and verified.
- The Header dropdown offered six languages, but `handleLanguageChange` did nothing.
- No i18n library, translation files or other consumer existed.
- Removed the state, refs, handler, list, `Languages` icon and UI. No English text was changed, and `<Html lang="en">` remains.

**M3. Public course search ran raw input as a regular expression.** Fixed; unit-tested.
- `GET /api/courses` does not require sign-in. Its `search` value went straight into `$regex`, so anyone could submit a catastrophic pattern. Array values caused errors.
- `lib/course-list-filter.js` now escapes the search text, caps it at 100 characters, and accepts plain strings only.

**M4. Leaderboard exposed student emails to every signed-in member.** Fixed; source-tested.
- Emails are now returned to admins and super admins only. The UI hides the line when no email is present.

**M5. A failed background profile refresh signed the user out.** Fixed; source-tested.
- A network error or 5xx response on `/auth/me` called `logout()`. Now only a 401 does. The server still validates the token on every request.

**M6. Forgot password showed server configuration to the public.** Fixed; tested.
- The page told end users to "Add TWILIO_* or TERMII_*…". It now shows a support message instead.

### Low

- **L1. Near-threshold contrast** (ratios of 4.02–4.47 against the 4.5 target) on a few small labels:
  - About stats;
  - the privacy and terms contact links in dark mode;
  - demo-trading tabs;
  - onboarding "Step 1 of 5".
  - Fixed instead: the `text-gray-400 dark:text-gray-500` pattern, which failed in both themes in 8 places; the red count badge; and the onboarding step numbers.
- **L2. Unauthenticated configuration probes:**
  - `/api/ai/check-config`
  - `/api/auth/check-email-config`
  - `/api/upload/check-config-public`

  These return booleans only. Left as is.
- **L3.** `/student-dashboard` and `/demo-trading` overlap in purpose. This is a product decision; not changed.

## Status summary

- **Fixed and verified** (by tests and the browser lab): H1, H3, M1, M2, the L1 items listed as fixed.
- **Fixed; behaviour verified in lab and tests, production effect not measured:** H2.
- **Fixed; verified by unit or source tests only** (no live server or database): M3, M4, M5, M6.
- **Unresolved by choice:** L1 near-threshold labels, L2, L3.
- **Not reproducible here:**
  - real Paystack popup behaviour and timings;
  - production response sizes and latency.
- **Blocked:**
  - **`explain("executionStats")` and real payload measurement:** this environment has no MongoDB access, and the network blocks Atlas.
  - **Learning indexes:** `lib/learning-indexes.js` defines seven indexes (L1–L7), while the brief mentions five installed. That can't be reconciled without database access; the plan script skips indexes that already exist, which may explain it. No index was created, dropped or changed. This round adds no new query shapes: it removes queries and adds one projection.

## Audit coverage

- **Inspected:**
  - checkout;
  - course, lesson and catalog data flow;
  - the theme system and every page layout;
  - language UI;
  - the auth bootstrap;
  - leaderboard, course list and forgot/reset-password;
  - the authentication wrapper on every API route.
- **Theme-scanned:**
  - public: `/`, `/how-it-works`, `/about`, sign-in, sign-up, forgot/reset password, help, legal, privacy, terms, support, courses;
  - student: dashboard, courses, course detail, lesson, student dashboard, demo trading, profile, progress, certificates, leaderboard, badges, community, ask, consultations, AI assistant, onboarding;
  - instructor: dashboard, lessons, quizzes, demo tasks, course editor, expert consultations;
  - admin: admin, purchases, consultations admin;
  - super admin: admin.
- **Not audited in depth:**
  - consultation chat and video;
  - instructor assignment grading flows;
  - socket event handling;
  - the AI assistant backend;
  - open dialogs and modals. Pages were scanned in their loaded state, and dialogs are covered only through the global class remaps.
