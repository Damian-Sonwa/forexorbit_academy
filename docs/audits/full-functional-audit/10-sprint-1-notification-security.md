# Sprint 1 — notification security

Date: 26 October 2026. No deploy, seed, migration, or production write was run.

## Model before the change

A notification row could omit `userId` and carry one `read` flag for every viewer. `createNotificationForRole` and `createNotificationsForUsers` already wrote one row per user. `createNotification`, `createNotificationForRoom`, and `POST /api/notifications` could insert one shared row for a role, for `all`, or for a room.

`GET /api/notifications` selected rows by role. Superadmin used an empty query. The student branch added every `community_message` that had any `roomId`. `roomName` was computed and unused. The header loads `GET /api/notifications?limit=50`, then `PUT /api/notifications` with `notificationId`, and `POST /api/notifications/mark-all-read`.

`PUT` loaded a row by id and set `read: true` with no owner check. Both mark-all paths updated every unread row for a superadmin.

## Design

One row per recipient in the existing `notifications` collection. Each row has `userId` and its own `read` flag. List, mark-read, mark-all, and delete use `ownedNotificationQuery`, which always includes that `userId`. A `community_message` with a `roomId` is included only when `decideCommunityRoomJoin` allows that room for the caller. The client does not supply the room.

Role and `all` creates fan out to personal copies. Socket delivery goes to `user:{id}` for each new copy. There is no `io.emit` of one shared payload. Responses use `presentNotification`, which omits `readBy`.

A caller may pass `dedupeKey`. A second copy with the same key and `userId` is not inserted. Producers that do not pass a key can still create a second personal row.

## Migration

No migration was applied. The current schema can store personal copies, so new writes do not need a new collection.

Rows already stored without `userId` stay in the collection. The new queries do not return or update them. An approved later job can copy each shared row into one personal row per intended recipient, preserve `createdAt` and content, and then leave or remove the shared original. Do not flip the shared `read` flag while doing that. A unique index on `(userId, dedupeKey)` for documents that have `dedupeKey` would close the check-then-insert race. That index was not created.

## Files

- `lib/notification-access.js` and `lib/notification-access.d.ts`
- `lib/notifications.ts`
- `pages/api/notifications/index.ts`
- `pages/api/notifications/mark-all-read.ts`
- `tests/notification-access.test.js`
- `package.json` test script

Class notifications, reminder scheduling, dependency versions, and the header click target were not changed. The community-message producer remains commented out.

## Tests executed

| Command | Result |
| --- | --- |
| `node --test tests/notification-access.test.js` | 10 passed, 0 failed, exit 0 |
| `npm test` | 153 passed, 0 failed, exit 0 |
| `npx tsc --noEmit --incremental false --pretty false` | exit 0 |
| `npx eslint` on the five notification files above | 0 errors, 7 warnings, exit 0 |

The notification tests use the in-memory store. They do not open MongoDB. The route test checks that both handlers call `ownedNotificationQuery` and do not return `error.message`.

Covered: foreign mark-read, missing id with the same 404 body, superadmin mark-all, independent copies, student room isolation, all four roles, stable error bodies, shared-row refusal, and dedupe.

## Remaining risks

- Legacy shared rows are invisible until the approved fan-out above. Their text is still stored.
- Dedupe without the unique index can still insert two copies under concurrent requests.
- Reminder delivery is still manual. `pages/api/reminders/check.ts` keeps its own unread check.
- `NOTIF-007` remains open for `pages/api/classes/index.ts`.
- Superadmin no longer receives every user's notification. A separate operational feed was not added.
- These tests do not prove the Mongo query planner returns the same rows as the memory filter.

## Recommendation

Proceed to Sprint 2. NOTIF-001, NOTIF-002, NOTIF-003, and NOTIF-004 are fixed in source and covered by the tests above. Sprint 2 should not run the notification migration, and it should not delete progress rows until the withdrawn-enrollment decision is accepted.
