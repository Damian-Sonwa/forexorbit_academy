# Enrollment and progress audit

Evidence class: static inspection of writers and readers. No enrollment was created or deleted.

## Relationship

There is no separate enrollment collection. A row in `progress` is the enrollment. Fields used as the contract: `userId`, `courseId`, `progress` (percent), `completedLessons`, `createdAt`, `updatedAt`.

`GET /api/courses` sets `enrolled` from the existence of that row and copies `progress`. `pages/dashboard.tsx` treats `course.enrolled` as the active-course list and sums `completedLessons` across every progress row returned by `GET /api/progress`.

Quiz results live in `quizScores` and are not part of the progress document. Certificates, badges, and points are separate collections.

## Lifecycle

```text
POST /api/courses/:id/enroll
  student token
  if progress row exists -> 400
  else insert progress 0 and empty completedLessons
  no course-exists check
  no notification

POST /api/progress
  requires a matching progress row
  append lesson id
  recompute percent from lesson count
  does not create a row

DELETE /api/courses/:id/enroll
  deleteOne that progress row
  quiz scores, certificates, and points remain
```

Re-enroll after delete inserts a new zero row. Previous lesson completion on that course is gone.

## Scenario matrix

| Scenario | Expected for active dashboards | Observed in source | Status |
| --- | --- | --- | --- |
| Enroll | course appears as enrolled with 0% | insert does that if the id is new | confirmed; course existence not checked |
| Complete lesson | percent updates for that enrollment | update requires the row; unit-tested | unit-tested decision, not a live write |
| Submit quiz | score stored; progress percent is lesson-based | quiz route writes `quizScores`; progress percent ignores quizzes | inspected |
| Refresh dashboard | enrolled list matches progress rows | both read the same collection | inspected |
| Unenroll | course leaves active totals; history kept | row is deleted, so totals drop and history is destroyed | PROGRESS-001 confirmed |
| Staff removes enrollment | no separate staff unenroll route found | only the student DELETE | missing capability |
| Course deleted | active totals should drop; history policy open | GET progress can return `course: null` and the dashboard still counts `completedLessons` | PROGRESS-003 |
| Re-enroll | product decision | new row at 0% | PROGRESS-005 |
| Progress without a real course | should not count as an active course | enroll allows it; GET still returns it | PROGRESS-004 |
| Enrollment without lesson rows | 0% and empty completed list | insert does that | inspected |
| Failed request mid-update | no partial lesson append | one `updateOne` after the array is built in memory | inspected |
| Concurrent enroll | one row | two inserts can pass the find | PROGRESS-007 suspected |
| Stale dashboard after unenroll | card disappears after refetch | delete removes the source row; no cache layer found | inspected |
| Quiz history after unenroll | retain, but do not add it to active percent | scores remain and are not joined once the progress row is gone | PROGRESS-002 |

## Consumers accounted for

- `pages/api/courses/index.ts` and `pages/api/courses/[id].ts`
- `pages/api/lessons/index.ts`, `lessons/[id].ts`
- `pages/api/quizzes/[lessonId].ts`
- `pages/api/assignments/**` enrollment checks
- `pages/api/progress/index.ts`
- `pages/dashboard.tsx` enrolled filter and `completedModules`
- `hooks/useCourses.ts`, `hooks/useProgress.ts`, `components/CourseCard.tsx`
- `pages/progress.tsx`
- `pages/api/instructor/analytics.ts` and assignment analytics count distinct `progress.userId`
- Leaderboard and badges were not found reading `progress` in this search; they use their own collections. Status: inspected at search level, not a progress aggregate.

## Product decision

Active dashboards should ignore rows that are not an active enrollment. Historical lesson completion, quiz scores, and certificates should remain stored. The safe default, until product says otherwise, is an `active` flag or a withdrawn status on `progress`, not `deleteOne`, and active aggregates filter `active !== false` plus a course that still exists.

Do not run a cleanup that deletes `quizScores` or progress history.
