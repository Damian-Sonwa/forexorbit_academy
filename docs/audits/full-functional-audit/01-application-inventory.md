# Application inventory

Evidence class: static inspection. The directory listing was taken from `pages/`, `components/`, and `hooks/` on 26 October 2026. `.next` and `node_modules` were excluded.

## Runtime

| Item | Location | Status |
| --- | --- | --- |
| Dev server | `package.json` `dev` → `node server.js` | active entry |
| Production start | `scripts/start-production.js` sets `NODE_ENV` then loads `server.js` | active entry |
| Next pages | `pages/**` | active routing |
| Middleware | `middleware.ts` redirects disabled feature paths to `/dashboard` | active |
| Database | `lib/mongodb.js`, `lib/mongodb.ts`, `db/mongoClient.ts`, `getDb()` default `Forex_elearning` | active |
| Socket.IO | `server.js`, client `hooks/useSocket.ts` | active |
| Env load | `server.js` loads `.env.local` if present, otherwise `.env` | active |
| Feature flags | `lib/config/features.ts`: certificates, community, and expert consultation are `false` | active for page routes only |
| Seed | `npm run seed` → `seed/seed.js`; startup also calls `scripts/seed-rooms.js` | dangerous if run; not run in this audit |
| Tests | `tests/*.test.js`, `node --test` only | no browser runner |

The folder is not a git repository, so a git status of uncommitted files could not be recorded. The working tree was not reset.

## Roles and account states

From `lib/account-access.js`: `superadmin`, `admin`, `instructor`, `student`. Inactive statuses: `pending`, `rejected`, `suspended`, `deactivated`, `disabled`, `inactive`. A missing status is treated as `approved`. Logged-out users have no token. `withAuth` is the API gate; page components also redirect by role.

## Page coverage

Status `inspected` means the route file was identified and its primary data path or shared chrome was traced. It does not mean a browser click-through.

| Route | Roles | Status |
| --- | --- | --- |
| `/` `pages/index.tsx` | logged out, all | inspected |
| `/about` `/help` `/legal` `/support` `/privacy` `/terms` | public | inspected as static pages |
| `/login` `/signup` `/forgot-password` `/reset-password` | logged out | inspected |
| `/onboarding` | student | inspected via API pair |
| `/dashboard` | student; others redirected | inspected |
| `/courses` `/courses/[id]` `/courses/[id]/lessons/[lessonId]` | catalog public; lesson gated | inspected |
| `/progress` | student uses `/progress`; staff calls missing `/progress/all` | inspected, defect CTA-002 |
| `/student-dashboard` `/student-dashboard/tasks/[id]` | student | inspected |
| `/demo-trading` | student | inspected via API surface |
| `/ai-assistant` | authenticated | inspected |
| `/badges` `/leaderboard` | student | inspected via API existence |
| `/certificates` | nav disabled; middleware redirects | inspected, flag off |
| `/community` | nav disabled; middleware redirects; APIs remain | inspected, CROSS-001 |
| `/consultations` `/consultations/expert` `/consultations/chat/[sessionId]` | nav disabled except admin tool path | inspected |
| `/profile` | authenticated | inspected |
| `/instructor/dashboard` `/instructor/courses/[courseId]` `/instructor/lessons` `/instructor/quizzes` `/instructor/demo-tasks` `/instructor/assignments/analytics/[assignmentId]` | instructor, admin, superadmin | inspected |
| `/admin` | admin, superadmin | inspected |

`pages/_app.tsx` and `pages/_document.tsx` are shell files, not product routes.

## Shared components

`Header` (notifications, theme, language, logout), `Sidebar` (role nav), `CourseCard` (enroll/unenroll/open), `LoadingSpinner`, `Quiz`, `TodoList`, `RemindersPanel`, `AIAssistant`, `Chat`, `VideoPlayer`, `RichTextEditor`, `FeatureGuard`, demo-task components, `AgoraCall`.

## API groups

Auth, courses and enroll, lessons, quizzes, progress, assignments, community, consultations, classes, notifications, reminders, todos, certificates, badges, challenges, forums, leaderboard, demo trading, uploads, AI, admin users and approvals, instructors, messages, socket. Count from the `pages/api` listing: 103 route modules. Each module is accounted for as present. Authorization depth varies; the four audit objectives were traced end to end. Other modules are inventoried, not each given a new finding unless a search hit a defect.

## Integrations

Twilio or Termii SMS for password reset (`lib` SMS helpers, env in `.env.example`). Resend is a dependency. Agora token route. Cloudinary upload config routes. OpenAI-style AI routes behind `AI_API_KEY`. OANDA demo broker code exists; it was not called. Socket.IO is the live channel.

## Commands that can change data

`npm run seed`, `node seed/seed.js`, starting `server.js` (room seed if a level room is missing), any POST/PUT/DELETE API, password reset, enroll/unenroll. None of those writes were executed for this audit.
