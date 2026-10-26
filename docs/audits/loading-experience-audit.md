# Loading experience audit

Date: 26 October 2026. Static inspection of the pages router, plus the code changes in this pass. Browser screenshots, slow-network simulation, and role-by-role visual passes were not run. Release status stays BLOCKED. This work does not change authentication rules, notification ownership, enrollment history, or feature flags.

## Visual system

The existing palette is warm copper (`primary-600` `#B85C0E`, accent `#F28C28`) on cream (`#FAF8F4`) with neutral-900 type, Inter/Poppins, and a `dark` class theme. Loaders reuse those tokens. No new font, image, or animation package was added.

The shared mark is a copper orbit arc. Motion is a short rotation, a top route bar, and a skeleton shimmer. `prefers-reduced-motion: reduce` stops those animations. Status text is in `role="status"` with `aria-live="polite"`. Decorative marks are `aria-hidden`.

`resolveLoadingPresentation` picks the treatment:

| Result | Meaning |
| --- | --- |
| `full-page` | Session is still unresolved. No protected content. |
| `blocked` | Session resolved and this viewer is not allowed. Existing redirect stays in charge. |
| `skeleton` | First load, no safe content yet. |
| `refresh` | Newer data is in flight and previous content stays visible. |
| `error` | The request failed. Not an empty list. |
| `empty` | The request succeeded with nothing to show. |
| `content` | Ready. |

## Primitives

| Piece | Role |
| --- | --- |
| `components/loading/OrbitMark.tsx` | Branded mark |
| `components/loading/FullPageLoader.tsx` | Session and other true full-page waits |
| `components/loading/LoadingStatus.tsx` | Compact announced status |
| `components/loading/Skeletons.tsx` | Metric, course card, table, lesson, and chart placeholders, plus `InlineLoader` |
| `components/loading/ButtonLoadingState.tsx` | Stable button label during a mutation |
| `components/loading/RouteProgress.tsx` | Thin top bar on route changes, cleared on success or error |
| `components/LoadingSpinner.tsx` | Existing call sites. Full screen uses `FullPageLoader`. Smaller sizes use `LoadingStatus`. |
| `lib/loading-presentation.js` | Pure treatment choice, covered by `tests/loading-presentation.test.js` |

`ChartSkeleton` is available for chart panels. No current chart waits on its own request, so it is not mounted yet.

## Matrix

| Route / component | Previous behavior | Problem | Treatment now | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| `hooks/useAuth.tsx` | Cached user was applied and `loading` ended before `/auth/me` returned | Protected pages could render from stale storage, then log out | `loading` stays true until `/auth/me` settles. Failure clears the session, then loading ends. No token skips the request. | Implemented | Source review. Not browser-tested. |
| `pages/_app.tsx` | No route indicator | Navigation felt unmarked | `RouteProgress` bar only. No full-page overlay and no artificial delay. | Implemented | Source review |
| `/login`, `/signup` | Button spinner, disabled while pending, `finally` clears it | Generic spinner | `ButtonLoadingState`. Disabled until the request finishes. | Implemented | Source review |
| `/forgot-password`, `/reset-password` | Text swap on a fixed-height button | Easy to miss | Same button treatment. Existing validation and ticket flow unchanged. | Implemented | Source review |
| `/dashboard` | Full-screen spinner for auth, progress, and extra fetches together | Empty and error states waited behind the spinner. Progress error copy was easy to miss during the wait. | Full-page loader only while the session is unresolved or the viewer is not a student. First progress load uses metric and course-card skeletons inside the shell. A later fetch keeps the page and shows “Updating your dashboard”. “Progress could not be loaded” and Try again stay. | Implemented | `resolveLoadingPresentation` tests. Page not visually checked. |
| `/progress` | Full-screen spinner for auth and every refetch, including socket updates | A refresh hid the page. Failure and empty were separate only after the spinner ended. | Full-page loader for the unresolved session. First load uses metric skeletons plus course cards (student) or table rows (staff). A later fetch keeps the current rows and shows “Updating progress”. Failure still says “Progress could not be loaded” with Try again. | Implemented | Source review |
| `/courses` | Centered spinner replaced the grid, including filter changes. Hook errors were ignored, so a failure looked like “No courses found”. | Empty and error were the same on screen | Skeletons when there is no list yet. Previous cards stay during a filter refresh. Failure has its own message and Try again. | Implemented | Source review |
| `/courses/[id]` | Full-screen spinner, and “Course not found” for both a miss and a failed request. Enroll said “Processing...”. Refetch set `loading` and replaced the page. | Error looked like an empty course. Socket refresh blanked the page. | Lesson-shaped skeleton on the first load. Staff redirect still uses the full-page loader. Error and not-found are separate. Enroll/unenroll uses the button state and stays disabled. Refetch no longer forces the first-load flag. | Implemented | Source review |
| `/courses/[id]/lessons/[lessonId]` | Plain “Loading lesson...” then “Lesson not found” for failures too | No retry. A slow id change could apply an older response. | Reading skeleton, separate error with Try again, request generation so an older response cannot replace a newer one. | Implemented | Source review |
| `components/Header.tsx` notifications | Small spinner inside the menu | Fine scope, generic look | Inline status plus three row placeholders. Mark-read and safe href behavior unchanged. Background refresh does not cover the page. | Implemented | Source review |
| `/instructor/dashboard`, `/admin` | Full-page spinner only while auth or role is unresolved. Saves already disable the button and say Saving. | Auth wait used the old spinner | Those waits now use the branded full-page loader. Save buttons were left as they were because they already block a second submit and keep their size. | Visual only | Source review |
| `/instructor/lessons`, `/instructor/quizzes` | Local ring while `authLoading` | Same generic ring | Branded full-page session loader. Form saves unchanged. | Implemented | Source review |
| `/instructor/courses/[courseId]` | Full-page spinner for the course load and for redirect | Acceptable blocking load for a management page | Inherits the branded full-page loader. Authorization checks unchanged. | Visual only | Source review |
| `/community` | Full-page spinner, then a section spinner | Feature flag still redirects this page before it is useful | Branded loader only. No community logic change. | Visual only | Source review |
| `/consultations`, `/consultations/expert`, `/consultations/chat/[sessionId]` | Full-page spinner. Chat dynamic import has its own “Loading call...” line. | Feature-off routes redirect. Chat depends on a session payload. | Branded full-page loader. The call chunk message was left because it is a module boundary, not page data. | Visual only | Source review |
| `/certificates` | Middleware redirect while the feature is off | A loader must not imply the feature is available | Unchanged | Left unchanged | `lib/feature-access.js` |
| `/leaderboard`, `/profile`, `/onboarding`, `/ai-assistant`, `/demo-trading`, `/student-dashboard`, `/student-dashboard/tasks/[id]`, `/instructor/demo-tasks` | Full-page `LoadingSpinner` until their primary fetch ends | Replacing every one with a custom skeleton would invent layouts for pages whose empty and error branches were not re-audited line by line | They now show the branded full-page loader. Demo-trading section spinners use the compact status. | Visual only | Call-site inventory |
| Demo-task submission lists | Non-fullscreen `LoadingSpinner` | Section-sized wait | Compact branded status | Visual only | Call-site inventory |
| Socket progress and notification refreshes | Pages refetched on events | A global overlay would hide work the user is doing | No global overlay. Progress keeps the current rows. | Implemented for progress. Other sockets unchanged. | Source review |
| Offline / timeout | Login maps timeout and network text. Other pages use their existing error copy. | No shared offline detector | No new timeout or retry loop. Login copy remains. | Left unchanged | Source review |

## Lifecycle notes

- Session loading ends on success, on `/auth/me` failure, on bad stored JSON, and when there is no token. An unmount sets a cancelled flag so a late response does not write state.
- Course list and lesson fetches ignore a response when a newer request has started. Loading is cleared only for the latest request.
- Course refetch after the first success does not flip the page back to the first-load skeleton.
- Progress refetch with existing rows sets `refreshing` instead of replacing the page. The first failure still sets “Progress could not be loaded.”
- Button mutations that were updated stay `disabled` for the request and clear in the existing `finally` path.
- No artificial delay and no automatic retry loop was added.

## Left unchanged on purpose

- Server authorization, enrollment withdraw/reactivate, notification ownership, and feature-flag 404s.
- Instructor and admin save buttons that already show “Saving...” and disable themselves.
- Certificate, consultation admin, and community business behavior.
- Empty copy such as “No courses found”, “No Progress Yet”, and “No active course enrollments found”.
- Release gate status.

## Verification

| Command | Result |
| --- | --- |
| `npm test` | Exit 0. 175 passed, 0 failed. Includes the four loading-presentation cases plus the existing 171 tests. |
| `npx tsc --noEmit --incremental false --pretty false` | Exit 0 after the button and lesson-hook fixes. |
| `npx eslint --quiet` on the edited loading files | Exit 0. |
| `node --check server.js` | Exit 0. |
| `npm run build` | Not run. The development server is using `.next`. |

Browser checks at mobile and desktop, reduced-motion, slow responses, and student, instructor, admin, and superadmin sessions were not run. No browser runner was available in this session, and production accounts were not used. HTTP responses from the local dev server were not treated as visual verification.
