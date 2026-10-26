# Loading and asynchronous UX audit

Evidence class: static inspection. Spinners were not timed in a browser. No failure was injected against the live server.

## Shared behavior

`components/LoadingSpinner.tsx` is the full-screen wait used by dashboards. `useAuth` blocks redirects until `authLoading` is false. `useProgress` sets `loading` and `error`, but `pages/dashboard.tsx` does not read `error`. `useCourses` sets an error string that catalog pages must choose to render.

Socket reconnect is handled inside `hooks/useSocket.ts`. Pages that subscribe in an effect remove listeners on cleanup. A failed socket leaves HTTP pages usable and live updates stale. That stale case was not simulated.

## Matrix

| Workflow | Wait | Empty | Error | Retry | Evidence |
| --- | --- | --- | --- | --- | --- |
| Student `/dashboard` | full-screen spinner while auth, progress, or dashboard fetch runs | copy when `enrolledCourses` is empty | progress hook error is not shown; upcoming-lesson failure is `console.error` and an empty list | none | LOAD-003 |
| `/courses` | hook loading | depends on page branch | hook error | refetch exists on the hook, not confirmed as a button | inspected |
| Course lesson | lesson hook sets `error` | n/a | string from axios message | none found | inspected |
| `/progress` | spinner | empty list after failure too | `console.error` only | none | LOAD-002, CTA-002 |
| Instructor course page | spinner around course load | restriction message when the caller cannot read lessons | course failure uses `alert` and redirects | none | CTA-001 |
| Header notifications | menu can open before fetch returns | not separately designed | errors not traced to a visible retry | none | suspected |
| Login and password reset | button loading flags cleared in `finally` | validation text | API `error` string | user can submit again | inspected |
| Community, certificates, consultations pages | middleware redirects before the page | n/a | n/a | n/a | flag off |
| Class list | instructor dashboard fetch | empty array on failure | `console.error` | none | inspected |
| Demo trading and consultations chat | local `setLoading(false)` in `finally` or catch | page-specific | `console.error` | not a shared retry | inspected |

## Findings

LOAD-002 and LOAD-003 are confirmed from source. Flicker, focus management, and small-screen spinner layout were not visually tested and stay unverified rather than passed.

Duplicate enroll clicks can both pass the “already enrolled” check before either insert. The second then receives 400, or both inserts could race. PROGRESS-007 records that race. No in-flight lock was found on the enroll button.

Authentication expiry depends on axios 401 handling in `lib/api-client.ts`. That client clears storage and redirects on 401. It was inspected, not executed.
