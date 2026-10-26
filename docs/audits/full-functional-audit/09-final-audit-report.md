# Final functional audit report

Date: 26 October 2026. Audit-only. Application code was not changed. No production deploy, production write, seed, or third-party message was performed.

## 1. Executive summary

The highest risks are shared notification read-state, staff progress calling a missing API, feature flags that hide pages while leaving APIs up, and unenroll deleting the only progress record.

Active course counts do drop after unenroll, because the `progress` row is the enrollment and `deleteOne` removes it. That also destroys lesson-completion history. Quiz scores stay in another collection and then disappear from the progress screen. The safe default is to mark the row inactive and filter active dashboards, not to delete it.

Overall risk: high, because of NOTIF-001, CTA-002, CTA-003, CTA-004, and PROGRESS-001. Release of notification or enrollment changes should wait for the product decisions in section 9.

## 2. CTA outcome

Shared chrome and the enrollment, progress, notification, class, and feature-flag paths were traced. Sidebar destinations exist or are intentionally disabled. No empty `onClick={() => {}}` or `href="#"` was found under `pages/**/*.tsx`.

Outcome counts for traced controls: 5 confirmed defects (CTA-001 through CTA-005), shared navigation otherwise consistent with the route list, instructor editor buttons covered as shared API handlers rather than individual browser clicks.

## 3. Notification matrix

In-app `notifications` documents, header fetch, optional socket `notification`, news `isRead`, class records without a notification write, and admin-triggered reminder check. Email and SMS were not invoked. Detail is in `03-notification-audit.md`.

## 4. Loading matrix

Student dashboard, catalog, lessons, progress, instructor course page, auth forms, and feature-blocked routes are in `04-loading-ux-audit.md`. Visual timing was not tested. LOAD-002 and LOAD-003 are the confirmed misleading empty states.

## 5. Enrollment and progress

Enrollment is a `progress` document. Writers: enroll insert, unenroll delete, lesson progress update. Readers: course list and detail, lessons, quizzes, assignments, both dashboards, instructor analytics. Scenario results are in `05-enrollment-progress-audit.md`.

## 6. Cross-feature findings

CROSS-001 through CROSS-007 in `06-cross-feature-regression.md`. They connect the CTA, notification, loading, and progress defects. They are not a second set of root causes.

## 7. Test evidence

`npm test`: 143 passed, 0 failed. Classification: unit tests, not end-to-end. No browser runner is installed. No isolated database writes were run. See `07-test-evidence.md`.

## 8. Prioritized findings

| ID | Severity | Status |
| --- | --- | --- |
| NOTIF-001 | high | confirmed |
| NOTIF-002 | high | confirmed |
| NOTIF-004 | high | confirmed |
| NOTIF-003 | high | confirmed |
| CTA-002 | high | confirmed |
| CTA-003 | high | confirmed |
| CTA-004 | high | confirmed |
| PROGRESS-001 | high | confirmed |
| PROGRESS-002 | medium | confirmed |
| PROGRESS-003 | medium | confirmed |
| PROGRESS-007 | medium | suspected race |
| CTA-001 | medium | confirmed |
| CTA-005 | medium | confirmed |
| LOAD-002 | medium | confirmed |
| LOAD-003 | medium | confirmed |
| NOTIF-005 | medium | confirmed gap |
| NOTIF-006 | medium | confirmed gap |
| NOTIF-007 | medium | confirmed |

Full fields, fixes, and tests are in `08-findings-and-remediation.md`. Nothing is marked fixed.

## 9. Decisions required

1. Keep withdrawn progress rows, or accept that unenroll erases lesson history.
2. Who should be notified when a class is created, changed, or removed.
3. Whether disabled community, certificate, and consultation pages must also disable their APIs.
4. Whether superadmin should see every notification document.

## 10. Remediation plan

Do this only after those decisions, and only against an isolated database for write tests:

1. Per-recipient notification rows and owner checks on mark-read.
2. Inactive enrollment flag, course-exists check, unique `(userId, courseId)` index in an approved migration.
3. Staff progress route or nav removal, and the same feature flag on hidden APIs.
4. Visible error and retry states; notification navigation after authorization is fixed.
5. Class notifications and a real reminder schedule, if product wants them.

## 11. Coverage

- Product page files inspected: 36, listed in `01-application-inventory.md`. `_app` and `_document` are shell files.
- API route modules accounted for: 103 under `pages/api`.
- Shared components with user controls: Header, Sidebar, CourseCard, Quiz, TodoList, RemindersPanel, and the demo-task set.
- Notification producers searched under `pages/api` and `lib`: demo tasks, demo review, reminders, manual POST, and a commented community block.
- Progress writers: enroll, unenroll, `POST /api/progress`.
- Empty-handler search in page components: no matches.
- Browser journeys: 0. Production functional checks: 0.

## 12. Production confirmation

No production deployment, production database write, seed, migration, or destructive cleanup was performed for this audit.
