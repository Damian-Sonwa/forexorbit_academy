# UI/UX audit and design-system plan — 28 October 2026

Scope: the whole Next.js app (pages router), every page route, and the four roles in the authorization model. Positioning: ForexOrbit Academy is a Forex **education** platform, not a broker or trading terminal.

## How this audit was done

- **Code review** of every page under `pages/`, the shared components, `tailwind.config.js`, `styles/globals.css`, the theme hook and `public/` assets.
- **Screenshots.** The app was rendered locally (`node server.js`, development mode) with placeholder settings and no database. A Playwright script answered the browser's `/api` calls with fixture data built from the repository's own seed builders (`scripts/seed-dev.js`) and response presenters (`lib/course-response.js`, `lib/enrollment-state.js`). No database, Paystack or production service was contacted.
  - 86 baseline screenshots: every public route (desktop and 390 px mobile), every student route (desktop and mobile), the instructor, admin and Super Admin routes (desktop), and five light-theme captures.
  - Fixture limits: endpoints without a fixture returned an empty list, so some screens show their empty state. Two crashes seen during capture (`/progress` for staff, `/admin/purchases`) came from fixtures with the wrong shape and were fixed in the fixtures; they are **not** reported as defects. External images (Unsplash instructor photos) could not load in this sandbox.
  - Not verified: real signed-in sessions, real data volumes, Socket.IO features, Agora calls, the Paystack popup, the AI assistant's answers, and browsers other than Chromium.

## Stack and design inventory

| Item | Finding |
|---|---|
| Framework | Next.js 15.5, pages router, React 18, TypeScript; custom `server.js` (Socket.IO) |
| Styling | Tailwind CSS 3 with custom `primary`, `orange`, `neutral`, `gray`, `accent`, `brand`, `nav` and level colours; `styles/globals.css` component classes (`.btn`, `.card`, `.input`, `.label`, `.page-title`, `.page-kicker`) |
| Fonts | Inter (body) and Poppins (display) from Google Fonts via CSS `@import` |
| Icons | `lucide-react`, plus many inline Heroicons-style SVGs (Header, Sidebar) |
| Theme | Class-based dark mode. **Dark is the default** (`<Html className="dark">`, `useTheme` defaults to dark; set in commit `02b694d`). Light is opt-in and saved in `localStorage`. Dark mode works by remapping light utilities globally (`.dark .bg-white { … }`), not by `dark:` variants alone. |
| Charts | `recharts` |
| Brand assets | `public/brand/fxorbit-logo.png`, `fxorbit-logo-light.png` (996×218), `fxorbit-mark.png`, favicon; PWA icons |
| Imagery | `public/images/smd.webp` (hero), `financial-learning-dashboard-devices.webp`, `young-trader-forex.webp` (auth), six catalog images in `public/images/catalog/` with mixed aspect ratios (1:1, 16:9, 9:16) |
| Logo orange | Sampled from the logo artwork: about `#FF7012` |
| UI orange today | `primary-400 #F28C28` (fills, dark text), `primary-600 #B85C0E` (white-text fills, links). 600 reads brown, not orange. |

## Roles and routes

Roles, from `lib/account-access.d.ts` (`AppRole`): **student, instructor, admin, superadmin**. "Expert" is a consultation capability (`isExpert` in `lib/config/features.ts`), not a separate role.

| Area | Routes | Roles |
|---|---|---|
| Public / marketing | `/`, `/courses`, `/courses/[id]` (preview), `/about`, `/how-it-works`, `/help`, `/support`, `/privacy`, `/terms`, `/legal` | everyone |
| Auth | `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/onboarding` | signed out / new student |
| Learning | `/dashboard`, `/courses`, `/courses/[id]`, `/courses/[id]/lessons/[lessonId]`, `/progress`, `/certificates` (feature-flagged "Soon"), `/badges`, `/leaderboard`, `/ai-assistant`, `/profile` | student (staff see variants) |
| Practice | `/student-dashboard`, `/student-dashboard/tasks/[id]`, `/demo-trading` | student |
| Community | `/community`, `/community/ask`, `/community/questions/[id]` | signed in |
| Consultations | `/consultations`, `/consultations/chat/[sessionId]`, `/consultations/expert`, `/consultations/admin` | student; experts; admin/superadmin |
| Instructor | `/instructor/dashboard` (incl. `?section=courses`), `/instructor/courses/[courseId]`, `/instructor/lessons`, `/instructor/quizzes`, `/instructor/demo-tasks`, `/instructor/assignments/analytics/[assignmentId]` | instructor (some also admin) |
| Admin | `/admin` (tabs: courses, users, instructors, analytics, certificates, approvals, classes, consultations) | admin, superadmin |
| Super Admin | `/admin/purchases`, `/admin?tab=approvals`, `/consultations/admin` | superadmin |

## Findings

Evidence key: **[S]** seen in a screenshot, **[C]** confirmed in code.

### Critical

1. **Signed-out visitors see an empty sidebar with a "Logout" button** on `/courses` (and every page that renders `Sidebar` without a session). [S][C] `components/Sidebar.tsx` renders its frame and logout button whether or not `user` exists. *Fix:* render nothing when there is no user. *Risk:* low; navigation for signed-in users is unchanged.
2. **Unreadable text in dark mode.** [S][C]
   - The level chips under the home hero render dark text on a near-black pill (`.dark .bg-white` remap with a fixed `text-[#525252]`).
   - In the MetaTrader setup guide (`components/student/SetupGuide.tsx`, used by `/student-dashboard` and `/demo-trading`), the mint-green panels keep their light background while the global dark remap turns their text light grey, giving almost no contrast.

   *Fix:* explicit dark variants for those surfaces. *Risk:* low.

### High

3. **Course images are missing outside the home page.** [S][C] `components/CourseCard.tsx` ignores `course.thumbnail`, so `/courses` and the dashboards show text-only cards. The home catalog shows images, the course detail page has none, and admin/instructor course lists have none. *Fix:* one shared cover component with a fixed 16:10 ratio, `object-cover`, a lazy load, and the existing catalog images as the deterministic fallback (as the home page already does). *Risk:* low; no data change.
4. **HTML entities shown as text.** "support **&amp;amp;** resistance" appears on the home catalog, `/courses`, the dashboard suggestion and admin cards. [S][C] `stripHtml(sanitizeForStudentView(...))` leaves entities encoded. *Fix:* decode entities in the plain-text preview path only. *Risk:* low (display only, text nodes are escaped by React).
5. **Brand orange is inconsistent and dull.** [C] There are 54 hard-coded `#F28C28`, 9 `#C85E0E`, 31 `#9A4E0C` and 21 `#102017` (a dark green used as "ink" on orange) outside the token scale, and `primary-600 #B85C0E` reads brown. Off-brand greens are used for primary actions ("Post Class", "Download MetaTrader"). *Fix:* the token update below, and replace hard-coded values with tokens.
6. **Broker/terminal positioning in the UI copy.** [S] The practice desk is titled "Trading dashboard" with a "Live Trading" tab, and the global footer says "Learn Forex trading with expert instructors and real-time market signals". *Fix:* education-first copy ("Practice desk", "Practice account", "learning community"). Practice features and the OANDA demo connection are kept unchanged.
7. **Destructive actions are the loudest controls.** [S] Every admin user row and course card has a filled red "Delete"; the course page's most prominent sidebar control is "Unenroll". *Fix:* quiet outline/ghost styling with the same handlers and confirmations. *Risk:* low.

### Medium

8. **Mobile navigation.** [S] The sidebar toggle floats below the header as a separate bordered square (`fixed top-[3.5rem]`), overlapping content and misaligned with the header. *Fix:* integrate it as a header-height bar on small screens.
9. **Duplicate navigation for staff.** [S] Instructor and admin pages show role links in the header **and** the sidebar, and `/admin` also has a tab strip with the same entries. *Fix:* keep the sidebar and tabs; hide the duplicate header links on screens where the sidebar is visible.
10. **Sidebar polish.** [S][C] Active items use a full orange fill plus a dot; a permanent green "online" dot is decorative and not backed by presence data; logout is a pink/red block. *Fix:* a tinted active state with an accent bar, no fake presence dot, and a neutral sign-out row.
11. **Thin dark-theme surfaces.** [S] Header, sidebar and footer are three slightly different blacks; cards inside dark sections switch to cream (`#f6f3ec`) panels, which looks inconsistent. *Fix:* one surface ladder (background, surface, raised) shared by both themes.
12. **Forms.** [S] Login/sign-up fields are underline-only with no visible box, and the disabled primary button is a faint peach. *Fix:* the shared `.input` treatment and a clear disabled state.
13. **Duplicate practice pages.** [S] `/student-dashboard` and `/demo-trading` repeat the same guide, tasks and journal. Merging them changes routes and behaviour, so it is **not** done here (decision needed).
14. **Performance smell.** [C] `* { transition-colors }` animates every element; the sidebar polls `/auth/me` every 5 seconds. The transition is narrowed to interactive elements; the polling is **not** changed (behaviour).
15. **Broken instructor photos have no fallback.** [S] Seeded instructor photos are remote Unsplash URLs; when they fail, the browser's broken-image icon shows. *Fix:* show the initial when an image fails.

### Low

16. Several `key` warnings in lists (`Leaderboard`, `AdminPanel`). [C]
17. The global focus ring offset colour is hard-coded to the light background. [C]
18. "Certificates — Soon" is shown in both the header and the sidebar for staff. [S]
19. The Next.js development badge overlaps some content in screenshots; it does not appear in production builds.

## Design direction

- **Theme:** keep both themes and keep dark as the default (an existing owner decision). Make both coherent from one token set.
- **Orange anchored on the logo (`#FF7012`)**, brighter and cleaner than today. Scale and WCAG contrast:

| Token | Value | Use | Contrast |
|---|---|---|---|
| 50 | `#FFF6EE` | tinted surfaces (light) | — |
| 100 | `#FFE8D5` | selected rows, badges (light) | — |
| 200 | `#FFCDA6` | borders on tinted surfaces | — |
| 300 | `#FFAB6B` | decorative accents | — |
| 400 | `#FF8A33` | orange text and icons on dark surfaces; hover for 500 | 8.5:1 on `#07080C` |
| 500 | `#FF7012` | **brand fill** with ink text (primary buttons, active nav, progress) | 6.8:1 with `#111111` |
| 600 | `#C24E00` | white-text fills; orange text on light | 4.8:1 white, 4.5:1 cream |
| 700 | `#A33F00` | hover for 600; strong text on light | 6.4:1 white |
| 800 | `#7C3000` | | |
| 900 | `#4F2004` | tinted surfaces (dark) | |
| 950 | `#2B1102` | | |

- **Neutrals and semantics stay** (success green, warning amber, error red) and are kept distinct from the brand orange.
- **Shape and depth:** 12–16 px radii, 1 px borders, restrained shadows, no glassmorphism, no neon.

## Implementation plan (this branch, uncommitted)

1. **Foundations:** tokens in `tailwind.config.js` and `globals.css`; shared `.btn` variants, `.input`, `.card`, focus-visible rings, reduced transitions; replace hard-coded brand hexes with tokens.
2. **Shared components:** `CourseCard` with cover images; a shared course-cover helper; `Header` (mobile nav slot, staff link de-duplication), `Sidebar` (signed-out fix, active state, sign-out), `Footer` copy.
3. **Public:** home (contrast, tokens, entities, image fallbacks), `/courses`, course detail cover and quieter unenroll, auth forms.
4. **Student:** dashboard width, practice desk copy and contrast, progress bars.
5. **Instructor and admin:** brand buttons instead of green, quiet destructive actions, course thumbnails in lists.
6. **Verification:** `npm test`, `tsc`, lint, build, then re-capture all routes and compare with the baseline.

## Not changed (needs a decision)

- Merging `/student-dashboard` and `/demo-trading`.
- Removing or relabelling the OANDA/MetaTrader broker links inside the practice guide (content, not styling).
- Switching the default theme to light.
- The 5-second profile polling in the sidebar.

## Implementation results (same day, uncommitted)

### What changed

| Area | Change |
|---|---|
| Tokens | `tailwind.config.js`: new `primary`/`orange` scale anchored on the logo (table above), `level-basic` aligned, `shadow-raised`. `styles/globals.css`: updated CSS variables, focus colour per theme. |
| Shared classes | `.btn` (+ `btn-primary`, `btn-secondary`, `btn-outline`, `btn-ghost`, `btn-danger-quiet`), `.chip`/`.chip-brand`, refined `.input` and `.card`; one `:focus-visible` outline for all interactive elements; colour transitions limited to interactive elements. |
| Dark theme | Low-specificity remaps for semantic tints and orange text written for light surfaces; areas designed on light hex colours (auth, community, landing hero and portfolio, how-it-works steps) are marked `.theme-section` and follow the theme (changed in the 2026-10-29 application audit; they previously stayed light in both themes). |
| Brand colours | All hard-coded `#F28C28`, `#C85E0E`, `#9A4E0C`, `#102017` replaced by tokens; `dark:text-primary-600` corrected to `dark:text-primary-400`. `lib/email.ts` (email templates) was not changed. |
| New helpers | `components/CourseCover.tsx` (fixed-ratio cover, thumbnail first, deterministic catalog-photo fallback, fallback on load error); `lib/plain-text.ts` (entity-decoded plain-text previews). |
| Shared layout | `Sidebar`: hidden for signed-out visitors (fixes the empty sidebar with "Logout"), tinted active state with `aria-current`, no fake presence dot, neutral "Sign out", labelled mobile "Menu" button. `Header`: staff links hidden where the sidebar shows them, accessible names on icon buttons, "Sign in"/"Sign up". `Footer`: education copy, broken `/contact` and `/faq` links replaced by `/support` and `/help#troubleshooting`. |
| Public | Home: covers, decoded previews, readable level chips, unified dark surfaces, instructor-photo fallback, light-theme search placeholder. Course detail: cover image, chips, quieter Unenroll, accessible progress bar. Auth: boxed fields. |
| Student | Dashboard wider, continue card with cover and progress bar, stat tiles. Practice desk renamed from "Trading dashboard"; "Live Trading" tab is "Practice account"; demo page title and lead are education-first. Setup guide and demo panels readable in dark. |
| Instructor / admin | Brand primary instead of green for "Post Class", approve and accept; quiet destructive buttons for delete, reject and cancel; admin course cards with covers and decoded previews; readable active tab and pending-approvals banner. |

Not changed: payment logic and `PaystackCourseUnlock`, authentication, authorization, API routes, data, the demo-trading behaviour and broker links, routes, the default theme.

### Verification

| Check | Result |
|---|---|
| `npm test` | 453 passed, 0 failed |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npm run lint` | exit 0, 0 errors, 586 warnings (unchanged category; 587–588 recorded earlier) |
| `npm run build` | exit 0, 43/43 static pages |
| Screenshots | 86 route/role/viewport/theme combinations re-captured with fixtures; no horizontal overflow at 390 px or 1440 px |
| Automated contrast scan (text vs effective background, WCAG AA) | **260 failing text nodes before, 38 after**; no screen got worse. Remaining: Recharts legend colours (admin analytics), onboarding step numbers, small gray helper text, a red required-field asterisk. |
| Payment fix | `lib/course-payment.js`, `package.json`, both payment test files and `Start ForexOrbit.bat` have the same SHA-256 as before this pass. |
