# Phase 7: learning experience and lesson delivery

Branch `feat/phase-7-learning-experience`, from `0935557` (the Phase 6 E1 release, live on Render). Nothing is pushed, merged or deployed. No database migration, no new dependency, no environment variable.

## 1. How it worked before (audit)

- **Lesson read** (`GET /api/lessons/:id`, `readLessonDetail`): account status, enrollment, course state, prerequisite and the Phase 6 paywall are all checked on the server before any content is returned. Locked lessons return only `{ access: false, locked, message, monetization, lessonMeta }`. Working correctly.
- **Lesson outline** (`?view=outline`): reads only navigation fields (no bodies). Working correctly.
- **Progress** (`POST /api/progress`): enrollment + Phase 6 paywall. Working correctly.
- **API caching**: the middleware sets `private, no-cache, no-store` on every non-static response; the service worker sends every `/api` request to the network.
- **Media**: lesson video, PDF and resources are instructor-entered external links (YouTube, Cloudinary, etc.). The app has no document or video upload.

## 2. Defects found

| # | Severity | Finding | Effect |
|---|---|---|---|
| P7-1 | **High (security)** | The Socket.IO `progressUpdate` handler (`server.js`) checked enrollment but not the Phase 6 paywall that `POST /api/progress` applies. | An enrolled student who never paid could record completion of paid lessons (and course progress up to 100 %) through the socket. |
| P7-2 | **High** | Lessons were completed only by the video `onEnded` event, sent fire-and-forget over the socket. No completion control existed. | Text-only lessons could never be completed; playback was treated as completion; nothing was shown if the socket was disconnected or the request failed. |
| P7-3 | **High** | The course page showed only `lessons.slice(0, 1)` until everything was unlocked. | With explicit free previews (Phase 4) the free lesson is often not first: students saw a locked first lesson and never the free preview. Demo lessons were hidden too. |
| P7-4 | Medium | Lesson PDF (`pdfUrl`) was never shown to students. Resource links exposed the stored storage URLs in lesson JSON and stayed usable after access was revoked. | Missing content; no server check on document retrieval. |
| P7-5 | Medium | `useLesson` had no request sequencing and kept the previous lesson in state while the next one loaded. | Fast next/next or browser back could display the wrong lesson under a URL. |
| P7-6 | Medium | A read-rule refusal (not enrolled) and 404 showed "This lesson could not be loaded — Try again". Network failures had no recovery; `useLessons` errors were not shown anywhere (the course page showed an empty list). | Non-actionable errors; retry loops that cannot succeed. |
| P7-7 | Medium | No course outline on the lesson page (the `Sidebar` ignored its `lessons` prop). The outline view lacked `completed` and `isFreePreview`. | No way to see position, completion or jump between lessons. |
| P7-8 | Medium | A lesson opened under another course's URL rendered with that course's outline and wrong previous/next. | Lost lesson context. |
| P7-9 | Low | Video player: no loading, buffering or error state; no resume. | Black box on slow networks; failed videos had no retry. |
| P7-10 | Low | The instructor's save on the lesson page called `router.replace(router.asPath)`, which did not refetch the lesson. A socket `lessonUpdated` refetch blanked the page to a skeleton. | Stale or flashing content. |
| P7-11 | Low | Middleware skipped the `no-store` headers for any path ending in a static extension, `/api/*` included. Lesson routes set no cache headers of their own. | Defence in depth only (no current `/api` route serves content at such a path). |

## 3. What was implemented

### Security and protected delivery
- **P7-1**: `server.js` `progressUpdate` now calls `courseContentAccess(...).isOpen(lessonId)` before `recordLessonCompletion`, the same rule as the HTTP route.
- **Protected documents** (`lib/lesson-documents.js`, `pages/api/lessons/[id]/document.ts`): students receive `/api/lessons/:id/document?item=pdf|r<n>` instead of stored URLs (lesson read, full lesson list, course detail). The route runs the full `readLessonDetail` rule on every request, then answers `302` to the stored link with `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`. Refusals return 401/403/404 with no `Location`. Only absolute http(s) links are served; other stored values are listed as unavailable. Staff keep raw URLs (the lesson editor needs them).
- **Caching**: lesson read, lesson lists, course detail and document responses set `Cache-Control: private, no-store, max-age=0` and `Vary: Cookie`. Middleware no longer exempts `/api/*` paths with file extensions.

### Lesson navigation
- `lib/lesson-navigation.ts`: previous/next, position, continue target, from the outline only.
- `components/student/LessonOutline.tsx`: outline beside the lesson (sticky on `lg`, collapsible toggle on phones), with current, completed (✓), locked and free-preview marks.
- Outline view adds `completed` and `isFreePreview` (`lib/lesson-outline-view.ts`).
- Lesson page: "Lesson N of M"; locked previous/next lead to the course page; canonical course URL redirect (P7-8).
- Course page: every lesson listed in order with its server lock state and badges (P7-3); locked lessons are not links; "N locked lessons in this course" with the existing unlock offer; "Start the first lesson / Continue: lesson N" for enrolled students; lesson-list error with retry.

### Video playback
- `components/VideoPlayer.tsx`: loading and buffering indicator, error state with **Try again** (also retried on `online`), `playsinline` for iOS.
- Resume position (`lib/playback-position.ts`): saved to `localStorage` every 5 s and on pause, per account and lesson (`fo-playback:v1:<userId>:<lessonId>`), resumed on ready if ≥ 5 s and > 10 s before the end, ignored after 90 days, cleared when the video ends. "Resumed at m:ss · Start over". Never sent to the server.

### Lesson completion
- `components/student/LessonCompletion.tsx`: explicit **Mark lesson complete** (students, open lessons only) calling `POST /api/progress`. One request at a time (ref guard + disabled button), `Saving…` state, specific error messages (offline, locked, not enrolled, rate-limited), always re-enabled. The outline and lesson update in place.
- The video ending only shows "The video has ended. Mark the lesson complete when…". The lesson page no longer emits `progressUpdate`.

### Loading, error and recovery
- `lib/lesson-request.ts` classifies every answer: ready, locked (unlock offer), forbidden ("Enroll in this course…" + link), not found (+ back link), retryable error, offline.
- `hooks/useLesson.ts`: request sequencing (only the newest answer applies), state tagged with its lesson id (no stale lesson after a route change), silent refresh for edits and socket updates (a failed silent refresh keeps the lesson), automatic retry on `online`. `useLessons` gains the same sequencing, a visible error, and retry on `online`.
- Offline banner on the lesson page (`hooks/useOnlineStatus.ts`).

### Mobile
- Outline collapses behind a 44 px toggle and closes after navigation; touch targets ≥ 44 px on navigation, documents and completion; documents open in a new tab (the browser's own viewer, which works on phones where inline PDF frames do not); no horizontal overflow (checked at 390 px).

## 4. Testing

Executed 1 November 2026:

| Suite | Result |
|---|---|
| `npm test` (all unit and route tests) | **831/831** (811 before + 16 in the new `tests/phase-7-learning-experience.test.js` + 4 new cases in `tests/lesson-loading.test.js`) |
| Phase 7 tests | 16/16, real route handlers with Phase 4.5 sessions and CSRF on the in-memory database. Mutation-checked: removing the socket gate, the student document view, the lesson `no-store` header, the document item check or the document access check each fails tests |
| **Phase 7 end-to-end** (`scripts/acceptance/learning-e2e.js`, new; real app, local MongoDB 9.0.4, headless Edge, desktop 1366 px and phone 390 px) | **73/73** |
| Phase 6 end-to-end (`scripts/acceptance/enrollment-e2e.js`; one assertion updated for the new course-page copy) | **42/42, one clean uninterrupted run** (0 failures, 0 DevTools timeouts). Earlier attempts: 41/42 (setup only: the local acceptance database kept the pre-0935557 index name `uniq_enrollment_user_course`, since dropped in that test database), then a run stopped after 27/27 while waiting on an untimed DevTools call. |
| Real MongoDB enrollment (`npm run test:mongo:enrollment`, local test server) | 3/3 |
| TypeScript (`tsc --noEmit`) | 0 errors |
| ESLint (`npm run lint`) | 0 errors, 627 warnings (existing patterns: `any`, unused catch variables, `require()` in CommonJS libraries) |
| Production build (`npm run build`) | passes |

The end-to-end run covers access for entitled, unpaid and unenrolled students; guessed URLs; document redirects and refusals; cache headers on the live server; the socket completion gate with a real Socket.IO client; outline and documents on desktop and phone; Next/Previous and browser Back/Forward with the network log showing only the target lesson fetched; video load, position saved, resume after reload, video end without completion; one completion request for a double click; a network failure with Try again; offline and automatic recovery; canonical course URL; not found; the course page lock presentation and Continue; no horizontal overflow at 390 px.

Harness fixes (test code only, no assertion changed; `enrollment-e2e.js` still has 39 `record` calls): every DevTools call in `enrollment-e2e.js` now answers within 30 s (a stuck page fails its check with a WARN line instead of hanging the run); both browser harnesses now quit Edge with `Browser.close` over DevTools before killing the launcher, because on Windows Edge's launcher hands off to another process and `kill()` left 8 to 16 headless Edge processes running after each run (checked: 16 before teardown, 0 after).

Not executed: Paystack test-mode charges (unchanged payment code; the server ran without a Paystack key), Firefox/Safari, real iOS/Android devices, YouTube/Vimeo playback (external network; the e2e uses a local WebM).

## 5. Limitations

- **External media**: the stored video URL is still sent to entitled students (the player needs it), and a document link, once followed, reveals the host URL. Access cannot be revoked at the host. True protection needs private storage with signed, short-lived URLs (for example Cloudinary authenticated delivery), which would be a separate change.
- **Download policy**: documents live on external hosts, so the app cannot force view-only or prevent saving.
- **Resume position** is per browser (Phase 8 covers cross-device sync).
- **Service worker** caches navigation HTML shells (no lesson content; lesson data is always fetched from `/api`). Unchanged.
- Firefox, Safari and real iOS/Android devices were not tested; the phone run is Edge with mobile emulation.
