# CTA audit

Evidence class: static inspection of handlers and destinations. No browser clicks. A control is not marked verified-in-browser.

## Shared controls

| Control | Where | Handler | Result |
| --- | --- | --- | --- |
| Sidebar links | `components/Sidebar.tsx` lines 131–181 | `next/link` or disabled div when `isNavHrefDisabled` | Destinations exist. Certificates, community, and expert consultation render as non-links while flags are false. Status: verified in source for students and staff. |
| Header login, signup, dashboard, logout | `components/Header.tsx` | `Link` and `handleLogout` | Destinations exist. Logout was not executed. |
| Notification row | `components/Header.tsx` | `handleMarkAsRead` only | Does not navigate to `relatedId`. See CTA-005. |
| Mark all read | Header | notifications API | Reaches `updateMany`. See NOTIF-001 and NOTIF-004. |
| Course card open | `components/CourseCard.tsx` | `/courses/${id}` | Destination exists. |
| Enroll / unenroll | `CourseCard` via `useCourses` | POST/DELETE `/api/courses/[id]/enroll` | Student-only. See PROGRESS-001 and PROGRESS-004. |
| Theme and language | Header | local UI state | Language choice was not traced to a persisted locale. Suspected cosmetic only. |
| PWA install | `InstallPwaPrompt.tsx` | browser install prompt | Not applicable without a browser install event. |

## Role navigation destinations

Student: `/dashboard`, `/courses`, `/progress`, `/student-dashboard`, `/ai-assistant`, `/leaderboard`, `/certificates` (disabled), `/community` (disabled), `/consultations` (disabled), `/profile`.

Instructor: `/instructor/dashboard`, course section query, `/instructor/demo-tasks`, `/progress`, disabled community and expert links, `/profile`.

Admin: `/admin` with tabs `users`, `courses`, `certificates`, `analytics`, plus disabled community and expert links.

Superadmin: admin tabs including `approvals`, `/consultations/admin` (not feature-blocked), `/profile`.

`/consultations/admin` is intentionally left reachable by `isExpertConsultationPath`.

## Traced workflow defects

### CTA-001 Instructor course management overstates access

- Severity: medium. The server correctly denies unassigned instructors.
- Roles: instructor.
- Files: `pages/instructor/dashboard.tsx` (“full access” comment and course links), `pages/instructor/courses/[courseId].tsx`.
- API: `GET /api/lessons`.
- Expected: an instructor who does not teach the course does not see lesson bodies, and the UI says so.
- Actual: the course page now skips the lesson request and shows a short restriction message. The dashboard copy still implies every course is manageable. Browser confirmation of the message was not repeated in this pass.
- Status: confirmed in source. The 403 overlay fix is already in the working tree.

### CTA-002 Staff progress page calls a route that does not exist

- Severity: high. Instructors and admins cannot load the progress screen they are sent to.
- Roles: instructor, admin, superadmin.
- File: `pages/progress.tsx` requests `` `/progress/all` ``.
- API: no `pages/api/progress/all.ts`. `pages/api/progress/index.ts` implements `GET /api/progress` for the caller’s own rows and `POST` for lesson completion.
- Reproduction: sign in as staff, open `/progress`.
- Expected: a staff progress view or a hidden nav item.
- Actual: the client calls an absent endpoint. The catch logs the error and clears loading, so the page can look empty. Not browser-executed.
- Status: confirmed in source.

### CTA-003 Disabled product areas stay callable as APIs

- Severity: high for authorization consistency.
- Roles: any authenticated caller who knows the URL.
- Files: `lib/config/features.ts`, `middleware.ts`, `components/Sidebar.tsx`, `pages/api/community/**`, consultation APIs.
- Expected: a feature hidden from navigation is also refused by its API, or the API is documented as still available to staff.
- Actual: middleware redirects `/community`, `/certificates`, and `/consultations` (except `/consultations/admin`). The community and consultation APIs are still mounted.
- Status: confirmed in source.

### CTA-004 Enroll does not require a real course

- Severity: high for data integrity.
- Roles: student.
- File: `pages/api/courses/[id]/enroll.ts` `insertOne` after a duplicate check only.
- Expected: unknown course ids are rejected.
- Actual: any string id can become a `progress` row.
- Status: confirmed in source. Not executed against the database.

### CTA-005 Notification rows do not open the related item

- Severity: medium.
- Roles: every role that sees the header menu.
- File: `components/Header.tsx` notification `onClick` calls mark-read only.
- Expected: a class, task, or message notification opens that record when the caller is allowed.
- Actual: no navigation. Combined with NOTIF-001, the click can also change another person’s read flag.
- Status: confirmed in source.

## Controls accounted for without a new defect

Login, signup, forgot-password, and reset-password submit to existing auth routes. Lesson completion posts to `/api/progress` and is covered by unit tests for enrolled students. Quiz submit and answer-key hiding are covered by `tests/quiz-access.test.js`. Assignment submit and grade routes exist and are covered by assignment unit tests. Demo-task create, submit, and review call existing demo-trading routes and create notifications. Class create, update, and delete exist on `pages/api/classes/index.ts` and do not emit notifications (NOTIF-005). Admin approval actions live on `/admin` and `pages/api/admin/approvals.ts`.

Large instructor editors (`pages/instructor/dashboard.tsx`, lessons, quizzes, course page) reuse save, delete, and quiz handlers that call the lesson and quiz APIs. Those handlers were not each clicked. Their server authorization is covered by the lesson and quiz unit tests. Empty `onClick={() => {}}` and `href="#"` searches in `pages/**/*.tsx` returned no matches.

## Coverage rule

Every sidebar and header destination above is marked. Repeated course-card actions are one implementation. Instructor form buttons are covered as shared save/delete handlers plus CTA-001, not as a per-button browser matrix.
