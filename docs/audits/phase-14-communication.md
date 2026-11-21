# Phase 14: Communication and real-time features

Branch `feat/phase-14-communication`, created from `5f87ecc` (origin/master: Phases 10–13 and the practical tasks, all integrated). Worktree `forexorbit_academy-phase-14-communication`. Not committed.

## 1. Audit before the changes

| Area | Found | Phase 14 |
|---|---|---|
| In-app notifications | Per-recipient copies with dedupe keys; community-room visibility rules; read and unread. | Reused as the event record. Delivery is now one shared path (`lib/communication/deliver.js`). |
| Notifications API | Page size taken from the query without a cap; unread count only counted the current page. | Pages capped at 50; `before`/`after` cursors; category filter; true unread count. |
| Real-time events | Routes emitted `notification` events ad hoc, some with full payloads; the client added them to its list and count. | `notification:new` carries only id, type, category and time, sent to the recipient's own room. The header refetches from the API on events and on reconnect. |
| Socket.IO | HttpOnly session cookie, origin check, periodic session recheck, server-decided rooms (lessons, community, consultations). | Kept unchanged. Added connection, refusal and disconnect counters. |
| Email | Resend for password reset and change only; idempotency key; no queue, tracking, retries or bounce handling. | Notification email queue with states, retries, backoff, terminal failures, suppression and signed webhooks. |
| Preferences | None. | Channel × category preferences; essential categories locked on. |
| Push | None (a PWA service worker exists). | Standard Web Push (RFC 8291/8292) on Node crypto; device management. |
| Community Q&A | Questions, replies, votes, accepted answers; owner or moderator edit. No reports or moderation. | Reports, moderation queue, hide/restore/clear, audit trail. |
| Consultations | Booking lifecycle rules, slot conflicts (unique index), access-checked Agora tokens, consultation chat rooms. | Reused unchanged (see section 8). |
| Community news | Admin and instructor news posts, with an ever-growing `readBy` list per post. | Untouched. Announcements share the collection and stay out of the news routes. |

## 2. Event contract and storage

The event is the per-recipient document in `notifications`:
- **Identity:** `_id` (the event id).
- **Content:** `type`, `category`, `title`, `message`.
- **Routing:** `userId` (recipient), `roleTarget`, and the resource reference (`relatedId`, `taskId` or `roomId`).
- **Destination:** `metadata.href`, a same-site path. The destination page checks access again.
- **Idempotency:** `dedupeKey`, per recipient.
- **State:** `createdAt`, `read`, `inApp`, and per-channel delivery under `channels.email` and `channels.push`.

No new collection was added, so the database role and Atlas are unchanged:
- **Preferences** (`communicationPreferences`), **email suppression** (`emailSuppression`) and **push devices** (`pushDevices` plus `pushEndpoints`) live on the user document.
- **Reports and moderation** live on the community question or reply itself.
- **Announcements** live in `communityNews` with `kind: 'announcement'`.

## 3. Email

**Template:** `lib/communication/email-sender.js`:
- Branded with the #FF7012 header rule; text is escaped.
- Category wording and button, a preferences link for optional categories, and essential wording for account messages.
- Unsafe links fall back to `/notifications`.

**States:**
- **queued, then sending, then sent:** "sent" means Resend accepted the message and returned an id.
- **delivered:** only on signed webhook evidence.
- **retrying:** a transient error. Backoff is 1 min, 5 min, 25 min, 2 h and 6 h, at most 5 attempts in total.
- **failed:** a permanent provider error, or attempts exhausted.
- **bounced or complained:** from the webhook.
- **suppressed:** the address is suppressed, the account is inactive, or the preference was turned off before sending.
- **skipped:** no address.

**Idempotency:**
- **One email per notification:** the provider key is `notification:<id>`.
- **One claim:** each claim is a conditional update on state and attempts.
- **Crash recovery:** a worker that died mid-send leaves a lease that expires; the resend reuses the same key.

**Re-checks at send time:** the user's preferences, suppression and account status are checked again just before sending.

**Webhooks:** `POST /api/webhooks/resend`:
- **Verification:** a Svix HMAC-SHA256 signature over the exact raw body, plus a timestamp within 5 minutes.
- **Idempotency:** each event id is applied once, and a state never steps backwards (a late "sent" doesn't undo "delivered").
- **Suppression:** hard bounces and complaints suppress the address for every later email.
- **No secret configured:** the route refuses with 503.

## 4. Preferences

**Categories:**
- account (essential);
- learning;
- consultations;
- announcements;
- community;
- messages.

**Channels:** in-app, email and push.

**Defaults:** in-app is on for every category. Email is on except for community and messages. Push is on for account, learning, consultations and messages.

**Applying them:** preferences are applied when a notification is created and again when it is sent, so changes take effect without signing out. Essential categories can't be turned off, and the API refuses any attempt. Turning in-app off for a category keeps the document for its other channels but hides it from the list.

## 5. Push

**How it works:**
- **No added dependency or paid provider.** Encryption follows RFC 8291 and is verified against the RFC's published test vector. VAPID ES256 follows RFC 8292.
- **Off by default.** Push stays off until `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are set; `scripts/generate-vapid-keys.js` creates a key pair.
- **Without keys:** push plans are marked "unavailable", and in-app and email still deliver.

**Devices:**
- **Ownership:** devices belong to the user document; members can only list, add or remove their own.
- **Allowed endpoints:** only known push services over HTTPS, so the server can't be made to POST to arbitrary URLs.
- **Shared browsers:** an endpoint registered by a second account is removed from the first.
- **Sign-out:** signing out removes that session's devices; signing out everywhere removes all.
- **Dead subscriptions:** a 404 or 410 from the push service removes the device.
- **Payload:** only `{ id, title, url }`.

The service worker shows the notification and opens the in-app destination when it's clicked.

## 6. Community moderation

**Reports:** `POST /api/community/reports`:
- one per member per post;
- members can't report their own posts;
- a reason is required, with details when the reason is "other";
- rate limited per account.

**Queue:** `GET /api/community/moderation` is for the existing moderator roles (instructor, Admin, Super Admin). It shows report reasons and counts, but not who reported.

**Actions:** hide, restore and clear each need a reason. Each one is recorded in the item's history and in the audit log (`community_hide`, `community_restore`, `community_clear`).

**Hidden content is kept as evidence.** It's removed from lists, and its detail page and replies are visible only to moderators and the author.

## 7. Announcements

**Audiences:**
- **Who can publish:** Admin and Super Admin can announce to everyone, all students or all instructors. Instructors can announce only to courses they teach.
- **Course announcements** go to students actively enrolled in that course, plus its instructor.
- **Only active accounts** receive announcements.

**Lifecycle:**
- **Statuses:** draft, scheduled, published, archived.
- **Scheduling:** the worker publishes scheduled announcements when due.
- **Expiry:** expired announcements stop being listed.
- **Audience changes:** a published announcement's audience can't change.
- **Notifications:** publishing notifies each recipient once (dedupe key `announcement:<id>`).
- **Audit:** create, edit, schedule, publish and archive are all audited.

**Read state** uses the recipient's own notification copy, so there's no reader list.

The community news routes (list, edit, delete, mark-read) exclude announcements.

## 8. Live chat, consultations and video (reused, verified)

These existing systems were audited and left unchanged; their existing tests still pass.
- **Consultation booking:** lifecycle rules, slot conflicts on a unique index, a cancellation cutoff, and server-side availability.
- **Agora tokens:** issued only to a session's participants, with an expiry.
- **Chat:** consultation, lesson and community rooms join through server-side decisions.

**Not added in this phase:**
- read receipts and unread counts for chat messages;
- consultation reminder emails beyond the existing reminder notification;
- a fallback when Agora is unavailable, beyond the existing chat.

The new pipeline does carry consultation notifications (category consultations) to email and push.

## 9. Real time and recovery

- **The database is the record.** `notification:new` is a hint sent to `user:<id>`, the room the server joins from the session.
- **Missed events:** a client that missed events catches up from `GET /api/notifications?after=<time>`. The header and the notification centre refetch on every event and on reconnect, so duplicate or missed events can't double-count or lose anything.
- **Ended sessions:** suspended or signed-out accounts lose their sockets through the existing session sweep.

## 10. Operations

**Page:** `/admin/communication`, backed by `GET /api/admin/communication` (Admin and Super Admin only).

**What it shows:**
- email state counts per window, queue depth, retries and suppressed addresses;
- recent terminal failures, with type, reason and attempts only;
- push states;
- socket counters (connections, refusals, ended by server, open sockets, live events) and the last worker run;
- which providers are configured, never their secrets.

**Logs:** structured, with no addresses or message contents.

## 11. Worker

`server.js` runs `lib/communication/worker.js` every `COMMUNICATION_WORKER_SECONDS` (default 30; 0 turns it off). Each tick publishes due announcements, then sends emails and pushes. Every step is bounded and idempotent, and overlapping ticks are skipped.

`scripts/communication-worker.js` only reports unless given `--apply`.

## 12. What needs owner action (not done)

1. **Email delivery webhooks:** in the Resend dashboard, add a webhook to `https://<site>/api/webhooks/resend` for sent, delivered, delivery_delayed, bounced, complained and failed. Then set `RESEND_WEBHOOK_SECRET` (the `whsec_...` value). Without it, emails are still sent and tracked up to "sent", and the route answers 503.
2. **Browser push:** run `node scripts/generate-vapid-keys.js` and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` on Render. Without them, push stays off.
3. **Recommended index, with approval** (the queue currently scans `notifications` every 30 seconds): a partial index on `notifications`, `{ 'channels.email.nextAttemptAt': 1 }`, where `channels.email.state` is in queued, retrying or sending. A webhook lookup index on `{ 'channels.email.providerId': 1 }` (sparse) is also recommended. Neither has been created.

## 13. Limitations

- **Provider integrations:** Resend, its webhooks and Web Push were verified with unit tests, the RFC test vector and signature checks, not against the live providers.
- **Per-process counters:** socket counters are per process and reset on restart.
- **Message-only categories:** the "messages" category exists, but direct chat messages don't yet create notifications through the new path.
- **Browser check:** not done with a live session. Layouts were checked in headless Edge.
