# Student experience UI/UX audit

Date: 27 October 2026. Local workspace only. No commit, deploy, or production data change.

## Inventory

Student and public entry routes that exist:

| Route | Purpose |
| --- | --- |
| `/` | Public landing. Already redesigned. Left as the marketing entry. |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | Authentication. |
| `/onboarding` | Optional profile. Skip already exists. |
| `/dashboard` | Student learning home. Staff are redirected. |
| `/courses`, `/courses/[id]`, `/courses/[id]/lessons/[lessonId]` | Library, course, lesson. |
| `/progress` | Student progress and staff rollups. |
| `/profile` | Account details. |
| `/student-dashboard`, `/demo-trading` | Practice desk. Kept. Not restyled as a terminal. |
| `/community`, `/community/ask`, `/community/questions/[id]` | Q&A. |
| `/consultations`, `/consultations/chat/[sessionId]` | Booking, plus the older chat session. |
| `/ai-assistant`, `/leaderboard`, `/badges`, `/help`, `/about`, `/terms`, `/privacy` | Secondary pages. |
| `/certificates` | Still behind the certificates flag and shown as Soon. |
| Header notification menu | There is no separate inbox page. |

There is no dedicated classes page. Upcoming classes, if any, arrive as reminders.

Shared pieces: `Header`, `Sidebar`, `Footer`, `CourseCard`, `Quiz`, loading skeletons, `page-kicker` and `page-title` in `styles/globals.css`. The default theme is black `#07080c` with orange `#F28C28`. Light mode stays available.

## What was wrong

The dashboard repeated the course catalog, a points total, a leaderboard link, a marketing block about what the training covers, and empty reminder and to-do panels. The next lesson existed, but it was one card among many. A learner with no next lesson was sent toward the trading dashboard first.

Courses had no app navigation. Community, progress, profile, and course detail also dropped the sidebar, so the learning pages did not feel like one product. Course cards always said Continue, including courses that had not been started. Lesson text sat in a generic card with a short measure only by accident. Quiz numbers used white text on a darker orange that fails contrast. Navigation called the practice area a trading dashboard.

## What this pass changed

The dashboard is now a narrow learning home:

1. A short welcome using the learner’s first name, with “there” if the name is missing. Returning learners and new learners get different lines.
2. Continue learning opens the next unfinished lesson in an active course. The link is the lesson, not only the course. A real thumbnail is shown when the course has one.
3. If progress cannot load, the existing “Progress could not be loaded” state remains, with retry.
4. A learner who has finished current courses is told that, with a link to the library.
5. A new learner gets a starting explanation and a link to courses. Onboarding is not forced.
6. Three numbers only: active courses, lessons completed through the existing active-enrollment total, and courses at 100 percent.
7. One catalog suggestion, labeled “From the catalog,” when an unenrolled course exists.
8. Extra unfinished lessons and upcoming consultations appear only when they exist. Reminders stay hidden when empty. The personal to-do list remains on the practice desk.

Courses are grouped into Continue learning, Completed, and Explore courses. Cards say Start, Continue, Review, or View course. Enroll and unenroll are unchanged. The course page, progress, profile, community, and consultations sit in the same sidebar. The practice link is labeled Practice desk and still opens `/student-dashboard`.

Lesson body copy uses a 68-character measure and more paragraph spacing. Completion rules, video end behavior, ads, and payment locks were not changed. Quiz question numbers and the submit button use the lighter orange with dark text. Correct answers still appear only after the server returns a result.

Onboarding copy says the form is optional. Skip for now remains.

## Preserved

Enrollment, withdrawn-course totals, lesson access, Paystack unlock, quiz grading, community authorization, consultation lifecycle, feature flags, and the certificates Soon state. No new dependency. No fake statistics.

## Still awaiting a full redesign

Authentication screens, the practice desk, AI assistant, leaderboard, badges, help, the lesson navigator on small screens, assignment pages, certificate presentation, the older consultation chat, and notification dropdown polish. Staff progress still uses its previous layout. Browser layout at desktop, tablet, and mobile widths was not walked through. A production build was not run while the local server was using `.next`.

## Checks

- `npx tsc --noEmit`: exit 0.
- ESLint on the redesigned pages and shared components: exit 0.
- `npm test`: 212 passed, 0 failed.
- Unauthenticated HTTP on the running local server: `/`, `/dashboard`, and `/courses` returned 200. That confirms the routes respond. It is not a signed-in walkthrough at desktop, tablet, or mobile widths.
- A production build was not run. A process is listening on `[::1]:3000`, so `.next` was left alone.
