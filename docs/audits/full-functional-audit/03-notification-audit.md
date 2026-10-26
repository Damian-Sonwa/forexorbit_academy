# Notification audit

Evidence class: static inspection. No notification was created and no SMS, email, or push was sent.

## Channels

| Channel | Implementation | Active |
| --- | --- | --- |
| In-app documents | `notifications` collection via `lib/notifications.ts` and `pages/api/notifications/index.ts` | yes |
| Header UI | `components/Header.tsx` fetches `/api/notifications` | yes |
| Socket push | `notification` event to `user:{id}` or `io.emit` for role `all` | only on some create paths |
| News feed | `communityNews`, `isRead` per user, `readBy` stored but not returned on GET | yes, page hidden by feature flag |
| Classes | `classes` collection | records only; no notification write |
| Reminders | `reminders` collection; `POST /api/reminders/check` | manual admin call, no scheduler found |
| Email / SMS | password-reset OTP providers | not exercised |
| Community chat | socket `message` | separate from the notification collection; the notification block in `pages/api/community/messages.ts` is commented out |

## Event matrix

| Event | Producer | Recipient rule in code | Persisted | UI | Status |
| --- | --- | --- | --- | --- | --- |
| Demo task created or updated | `pages/api/demo-trading/tasks.ts` | `createNotification` | yes | header if the query matches | inspected |
| Demo task submitted | `pages/api/demo-trading/tasks/[id]/submit.ts` | instructor-targeted | yes | header | inspected |
| Demo submission reviewed | `pages/api/demo-submissions/[id]/review.ts` | student user id | yes | header | inspected |
| Reminder due | `pages/api/reminders/index.ts` and `reminders/check.ts` | `userId` on the reminder, type `live_class_reminder` | yes | header, only if check is called | missing scheduler |
| Class created, edited, deleted | `pages/api/classes/index.ts` | none | class row only | instructor dashboard list | missing notification |
| Community message | commented block in `messages.ts` | would target instructors | no | socket message only | not active |
| News item | `pages/api/community/news.ts` | readers of the news API | news document, per-user `isRead` | community page, currently feature-blocked | inspected |
| Enrollment | `enroll.ts` | none | progress row | course card | no notification |
| Lesson progress | `progress/index.ts` | socket listeners exist on instructor dashboard | progress row | dashboards | no notification document |
| Manual announcement | `POST /api/notifications` | caller chooses `userId` or `roleTarget`; `all` uses `io.emit` | one shared document | header | see NOTIF-002 |

## Read state

`read` is a boolean on the notification document, not a per-recipient set.

`PUT` mark-read in `pages/api/notifications/index.ts` loads the document and sets `read: true` without comparing `userId` or `roleTarget` to the caller. The comment says the check exists. The statements do not perform it.

`POST /api/notifications/mark-all-read` and the in-file mark-all path use the same role query. For `superadmin` the query is every unread notification.

Student GET includes every `community_message` that has any `roomId`. `roomName` is computed from learning level and then unused.

Superadmin GET uses an empty query, so that role receives every user’s notifications.

Several 500 responses include `error.message` (`notifications/index.ts`, `mark-all-read.ts`, `classes/index.ts`).

## Findings

NOTIF-001, NOTIF-002, NOTIF-003, NOTIF-004, NOTIF-005, NOTIF-006, and NOTIF-007 are recorded in `08-findings-and-remediation.md`.

## What is not a notification

Todos are a personal list (`pages/api/todos/index.ts`, `TodoList`). Community messages are a room feed. News is a feed with its own read model. Those were not treated as the header notification channel.
