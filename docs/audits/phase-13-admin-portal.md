# Phase 13: Admin portal and platform operations

Branch `feat/phase-13-admin-portal`, from `d1bd4a2` (origin/master, Phase 12 live). Not committed.

## 1. Audit (before changes)

**Reused (already correct):**
- Account approval and rejection, and suspension and reactivation: Super Admin only, reasoned, audited; suspension ends sessions.
- The live account check on every request; login and password reset refuse inactive accounts. There are no OAuth routes.
- Course status transitions (audited) and Phase 12 reassignment (audited).
- Financial operations (Phase 5), all Super Admin only: the purchase ledger, read-only Paystack verification, refunds (idempotent request ids; completion only on Paystack's report), payment exceptions, and the reconciliation pass (proven repairs plus diagnostics D1 to D7).
- Complimentary access grants (reasoned, audited) and the append-only audit log.

| Gap or defect | Fix |
|---|---|
| No portal home, alerts or trend | `/admin/overview` |
| User list unpaginated (all users in one response); no detail view | Server-paginated search and detail |
| No course oversight list or instructor-attention view | `/admin/courses` |
| No enrollment and entitlement search | `/admin/enrollments` (read-only) |
| No view of pending, abandoned, stalled or held checkouts | `/admin/payments` (every checkout state) |
| Refunds visible only per payment | `/admin/refunds` |
| Reconciliation panel buried in the ledger; runs not audited | Shared `ReconcilePanel`, `/admin/reconciliation`, run audit |
| No reports or exports | `/admin/reports`, CSV exports |
| Audit viewer had only an entity filter | Actor, action, date and reference filters |
| No configuration visibility | `/admin/settings` (read-only) |
| Super Admin not told about pending accounts | Signup notification (Super Admin only, deduplicated) |
| Admin analytics loaded every full course document | Titles only, five courses |

## 2. Role policy (unchanged and enforced server-side)

- **Admin and Super Admin:**
  - overview (non-financial), users and instructors, courses, enrollments without payment references;
  - non-financial reports, course and enrollment exports, read-only configuration.
- **Super Admin only:**
  - payment figures, payments, refunds, reconciliation, financial reports;
  - user, payment, refund and audit exports;
  - account history, phone numbers;
  - approval, suspension, grants and refunds (existing routes).

Super Admin-only parts are omitted from responses for admins, not just hidden in the UI.

## 3. API

All under `/api/admin/portal/*`. They're GET only, private, rate-limited (`admin-portal-read` 600 per 10 minutes; exports `admin-portal-export` 30 per 10 minutes) and go through withAuth, which checks the live role and status.

`overview`, `users`, `users/:id`, `courses`, `enrollments`, `payments`, `refunds`, `reports`, `config`, `audit`, `export`.

The portal adds no write path to financial or academic records. Exports write only their own audit entry, and a test asserts the portal code contains no update or delete operations.

## 4. Definitions

- **Checkout states:** see the lib/admin-portal.js header.
  - `abandoned` means "no payment reported" (pending for over 24 hours or expired), never a provider failure.
  - An unrecognised status is `unknown`, never success or failure.
- **Money:** kobo integers summed as BigInt and formatted as strings. Gross = paid checkouts by `paidAt`; refunds = refunds with status `processed`, by `updatedAt`; net = gross minus refunds. Pending checkouts are never revenue.
- **Users:** active = status approved (or none, for legacy records). Active learners = distinct users with a learning day in the window.
- **Exports:**
  - The same filters as the screen, at most 10,000 rows.
  - Cells starting `= + - @`, a tab or a carriage return get an apostrophe prefix; quotes are doubled; cells containing commas or line breaks are quoted.
  - Every export writes an audit entry (type, filters, row count, actor). If that entry can't be written, no file is produced.

## 5. Settings decision

The platform has no runtime-editable settings: payment, email, media, AI and advertising configuration are deployment environment variables. The settings page shows which integrations are configured (never secret values) and states that changes are made by redeploying. An environment editor was deliberately not built.

## 6. Database impact

No new collection, index or schema change, and no production change is needed.

Known bounded scans (fine at the current size):
- users by `createdAt`;
- checkouts by `createdAt`;
- `learningDays` by `day`;
- the audit log by actor.

Indexes for these can be added if volume grows.

## 7. Limitations

- **Provider truth:** comes only from the existing reconciliation and verification paths. The payments list shows local records and labels uncertain states as such.
- **Webhook processing status:** not stored per event; failures surface as payment exceptions and reconciliation diagnostics.
- **Browser:** not verified with a live session. Layout was measured in headless Edge at 360 and 390 px with service-generated data.
