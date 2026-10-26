# Cross-feature regression

Evidence class: comparison of the phase 2–5 source traces. None of these interactions were clicked in a browser.

| ID | Interaction | Status |
| --- | --- | --- |
| CROSS-001 | Sidebar hides community, certificates, and consultations, while middleware redirects those pages. The APIs still accept calls. A disabled control is not a disabled capability. | confirmed |
| CROSS-002 | Unenroll deletes the progress row, so the course card and active counts drop. `quizScores` remain and disappear from the progress API because the join is the deleted row. History and active totals disagree. | confirmed |
| CROSS-003 | Header “mark read” writes the shared `read` flag. One student can clear a role-wide or another user’s notification for everyone. | confirmed |
| CROSS-004 | Creating a class updates the class list only. No `live_class_reminder` is written. Reminders are a separate collection and fire only when an admin calls `/api/reminders/check`. | confirmed |
| CROSS-005 | Staff open `/progress` from the sidebar. The page requests `/api/progress/all`, which is absent, then ends loading with a console error. The student branch of the same page is valid. | confirmed |
| CROSS-006 | Instructor dashboard links to any course. Lesson fetch is now skipped when `canReadCourseLessons` is false, so the 403 overlay should stop. The dashboard label still says the instructor has full access. | confirmed in source |
| CROSS-007 | `GET /api/progress` failure leaves `useProgress.error` unset on the student dashboard. The empty-enrollment message can describe a failed request. | confirmed |

Regression tests to add when fixes are implemented are listed on each finding in `08-findings-and-remediation.md`. They must use an isolated database for any enroll, unenroll, or notification write.
