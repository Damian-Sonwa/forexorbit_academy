# Admin, instructor, and consultation availability audit

Date: 27 October 2026. Local workspace only. No production write.

## Root cause

Learners book from `/consultations`. Eligible providers are users with `isExpert: true` and a role of instructor, admin, or superadmin. Open times come from `users.expertSchedule`. If that field is missing, slot listing returns an empty list and booking returns “This expert has not published availability.”

Publishing is `PUT /api/consultations/experts`. Before this fix it rejected anyone whose stored `isExpert` flag was not already true, including the super admin. Nothing in the product marked a super admin as an expert automatically.

The super admin dashboard at `/admin` hid the sidebar. The only prominent extra link was Community. Consultation availability lived at `/consultations/expert`, which the super admin therefore did not see. The sidebar also pointed at `/consultations/admin`, and that page did not exist, so expert approval had an API and a dead link.

Saving hours did not opt the super admin into `isExpert`, so a super admin who found the form still could not persist a bookable schedule.

## What “published” means

There is no separate draft record. A saved `expertSchedule` is the published weekly pattern. `expertAvailable: false` pauses new slots and leaves existing bookings in place. Booked times are removed from the generated slot list. Confirmed consultations are not deleted when the weekly hours change.

## Fix

- A super admin who saves weekly hours is marked `isExpert` in the same update. Pausing before that save is rejected.
- An instructor or admin can publish only after a super admin sets `isExpert`. Students cannot. Approving a student as an expert is rejected.
- `/consultations/expert` is labeled Consultation availability and explains the approval rule.
- `/consultations/admin` is a real super-admin page: turn bookings on or off, approve or remove staff experts, and link to Publish my hours.
- The super admin dashboard shows the shared sidebar plus Publish hours and Approve experts.
- The learner empty states say that no expert has published hours, or that the selected expert has none in the next 14 days.

## Role map

| Role | Learning or admin home | Consultation hours | Expert approval |
| --- | --- | --- | --- |
| Student | `/dashboard` | Cannot publish | No |
| Instructor | `/instructor/dashboard` plus sidebar | `/consultations/expert` after approval | No |
| Admin | `/admin` plus sidebar | `/consultations/expert` after approval | No |
| Super admin | `/admin` plus sidebar | `/consultations/expert`, self-approval on save | `/consultations/admin` |

Instructor course, lesson, demo-task, progress, and community links were already in the sidebar or instructor dashboard. Admin tabs for users, courses, classes, consultations, certificates, and analytics were already on `/admin`. Certificates stay behind the existing Soon flag.

## Checks

- `node --test tests/consultation-booking.test.js`: 9 passed, 0 failed.
- `npx tsc --noEmit`: exit 0 after the availability type fix.
- ESLint on the consultation and admin files: exit 0.
- A production build was not run because the local dev server is using `.next`.
- A signed-in browser booking was not performed.

## Still limited

Reminders are still the authenticated admin route `POST /api/consultations/reminders`. Nothing in the process calls it on a timer. Consultations are not charged. Browser booking was not walked through with a signed-in super admin. A production build was not run while the local server was using `.next`.
