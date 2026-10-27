# Expert consultation audit

Date: 26 October 2026. Local workspace only. No production migration, payment, or database write was run for this change.

## 1. Original architecture

Consultations were a request-and-chat feature, not a scheduled booking system.

- Learners opened `/consultations`, picked an expert marked `isExpert`, and sent a topic, description, and type (`live-chat`, `audio-call`, or `video-call`).
- The request was stored in `consultationRequests` with status `pending`. Learners were not shown their own pending requests.
- An instructor whose id matched `expertId`, or an admin, accepted or rejected it at `PUT /api/consultations/requests/:id`.
- Accept created `consultationSessions` with status `active` and opened `/consultations/chat/[sessionId]`, including an Agora token route for voice and video.
- Experts had a boolean `expertAvailable`. There was no timezone, weekly hours, duration, buffer, or slot list.
- `GET /api/consultations/experts` returned name, email, photo, role, and availability.
- A superadmin could turn the feature off with `consultationEnabled: false` and mark users as experts through `/api/consultations/admin`. That admin API stays outside the feature flag.
- The `EXPERT_CONSULTATION` flag gates `/consultations` and `/api/consultations`, except the admin API.
- Paystack verifies course payments and unlocks a course. It does not know about consultations.
- In-app notifications exist. Email is limited to password reset through Resend. There is no consultation scheduler.

## 2. What already worked

- Authenticated learners could create a pending request for an available expert.
- The assigned instructor could accept or reject it. Admins could act on any request and cancel.
- Accept created a chat session. Socket membership for that session was already authorized.
- The feature flag and admin expert toggle were in place.

## 3. What was missing or unsafe

- No date, duration, timezone, or double-booking check. Accept started a session immediately.
- Learners could not see pending requests, so the dashboard hid the booking they had just made.
- The expert list returned email addresses to every signed-in caller.
- Request bodies were not length-limited or stripped of markup.
- Status changes were a small action list. A learner could not cancel. Nobody could complete, reschedule, or record a no-show under a checked lifecycle.
- Agora was the meeting path. The product decision is external Google Meet or Zoom, with no embedded calling in this pass.
- There was no price field and no consultation payment record. A browser could not pay for a consultation, and a course webhook could not mark one paid.
- No meeting-link field, allowlist, or visibility rule.
- No reminder job.

## 4. Target lifecycle

New bookings use `consultationRequests` and set both `lifecycle` and the older `status`.

| Lifecycle | Legacy status | Meaning |
| --- | --- | --- |
| PENDING_CONFIRMATION | pending | Learner requested a free slot. Expert must accept. Hold expires after 24 hours. |
| CONFIRMED | accepted | Expert accepted. A meeting link may be added. |
| RESCHEDULE_REQUESTED | accepted | Learner proposed another open slot. The original slot stays until the expert accepts. |
| CANCELLED | cancelled, or rejected when declined | Released. |
| COMPLETED | completed | Expert or admin, only after the start time. |
| NO_SHOW | completed | Expert or admin, only after the start time. |

There is no `PENDING_PAYMENT`, `REFUND_PENDING`, or `REFUNDED` state. Consultations have no stored price, and this change does not invent one. `paymentStatus` is `not_required` and `amount` is null. A client cannot set either.

Permitted actions are enforced in `lib/consultation-booking.js`:

- Expert or admin: accept, decline, cancel, complete, no-show, accept a reschedule, set the meeting link.
- Learner: cancel a pending request, cancel a confirmed request until one hour before the start, request a reschedule onto another open slot.
- A learner cannot accept, complete, report a no-show, or set the link.
- Nobody can post an arbitrary lifecycle or payment status.

Old requests without `lifecycle` still map from `pending`, `accepted`, `rejected`, `cancelled`, and `completed`. Accepting an old request that has no start time still creates an active chat session.

## 5. Scheduling

Experts who are already `isExpert` save a timezone, 30 and/or 60 minute durations, a buffer of 0, 5, 10, or 15 minutes, a short focus line, and weekly windows. Windows stay inside one day so overnight ranges are rejected.

Slots are generated for at most 14 days, at least 15 minutes in the future, inside those windows, and outside active bookings plus the buffer. The booking API recomputes the slot. The browser check is not the lock.

Concurrency: the server checks for an overlap, inserts, then looks for an earlier overlapping active request. If one exists, the new row is deleted and the caller gets a conflict. Two racing requests can also both delete themselves. That fails closed instead of confirming two people into one slot. A unique index on `expertId` plus `slotKey` for active lifecycles is described by `scripts/consultation-booking-indexes.js`. The script does not connect to MongoDB and refuses `--apply`. The index was not created.

Abandoned `PENDING_CONFIRMATION` rows with `holdExpiresAt` in the past are cancelled when slots or bookings are read or created. Older rows with no hold are left alone. There is no background worker.

## 6. Meeting links

An expert or admin may save an `https` Google Meet URL (`meet.google.com/abc-defg-hij`) or Zoom URL (`zoom.us` or a `*.zoom.us` host whose path starts with `/j/`). Other schemes, hosts, and embedded credentials are rejected.

The link is returned only for a `CONFIRMED` booking, only to the learner, the assigned expert, or an admin, and only until three hours after the start. Other lists do not receive it. Notifications say the link is ready and link back to the consultation page. They do not include the URL. The join control opens the validated URL in a new tab. Possession of the URL is not an application login.

The app does not create the meeting and does not claim Google or Zoom verified it.

## 7. Payments

No consultation price exists on expert profiles or historical requests. Paystack remains the course-unlock webhook. The booking store does not call it, and the webhook does not read `consultationRequests`. A consultation cannot unlock a course, and a course payment cannot confirm a consultation.

Refunds are not offered because no consultation charge exists. Do not treat `not_required` as a completed refund.

## 8. Notifications and reminders

Personal in-app notifications go to the other party for a new request, confirmation, cancellation, reschedule request, and meeting-link save. Each uses a dedupe key.

`POST /api/consultations/reminders` is limited to admin and superadmin. It claims each confirmed booking that starts within the next hour once, then notifies the learner and expert without the meeting URL. Nothing in the process calls this on a timer. An operator can call it with an admin session about hourly. If that job is not configured, reminders are not automatic.

Email is not sent for consultations.

## 9. What was preserved

- Chat sessions, Agora token route, socket consultation membership, and consultation messages.
- Admin expert approval and the consultation on/off switch at `/api/consultations/admin`.
- Feature-flag behavior, including the admin exception.
- Course Paystack verification and unlock.
- Existing request rows. New fields are additive.

## 10. Security notes

- The caller comes from the verified session.
- A learner cannot read another learner's booking. An expert cannot read another expert's booking.
- Expert discovery no longer returns email.
- Markup in topic, description, and focus is stripped.
- Booking creation is rejected for non-learners. Availability changes require `isExpert`.
- Logs record the action and booking id, not the meeting URL or message body.
- Failures use the shared safe error body. Known booking errors use a fixed client string.

Rate limiting specific to booking was not added beyond the existing auth middleware. That remains a follow-up.

## 11. Checks

These tests do not open MongoDB and do not move money.

- `node --test tests/consultation-booking.test.js`: 8 passed, 0 failed.
- `npm test`: 212 passed, 0 failed. That run includes the consultation tests and the existing community, enrollment, and consultation-socket tests.
- `npx tsc --noEmit`: exit 0.
- ESLint on the consultation pages, booking APIs, store, and admin page: exit 0.
- `node --check` on `lib/consultation-booking.js` and `scripts/consultation-booking-indexes.js`: exit 0.
- Unauthenticated HTTP on the running local server: `/consultations` and `/consultations/expert` returned 200 HTML without an application-error marker. `/api/consultations/experts` returned 401. This is not a browser walkthrough of booking, payment, or meeting links.
- A production build was not run. A process is listening on `[::1]:3000`, so a build was not written into the live `.next` directory.

## 12. Remaining decisions

- Whether consultations should ever be paid, and at what price. Not implemented.
- Creating the slot unique index after a duplicate check on real data.
- An external hourly call to `POST /api/consultations/reminders` by an admin session.
- Official Google Meet or Zoom APIs. Not integrated.
- The signed-in expert receives their own saved weekly grid from the expert list. Other callers do not.
- Browser layout and the booking click-path were not verified in a browser. The HTTP check above only shows the routes respond.
- A production build was not run while the local dev server was listening, so `.next` was left alone.
