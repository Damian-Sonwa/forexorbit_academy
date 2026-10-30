# Phase 1–3 remediation: authorization, account lifecycle and privacy

Branch `fix/phase-1-3-security-remediation`, based on `bafd0c2` (H3 fix + email password reset). Nothing here is deployed. Sections marked **Decision** need the owner's approval before anything is built; they describe options, not adopted policy.

## 1. Roles and permissions

Server-side enforcement in every case: `withAuth` checks the signed JWT, the live account record (role and status) and the session generation on every request; the socket handshake and socket events do the same. Hidden buttons are convenience only.

| Capability | Student | Instructor | Admin | Super Admin | Where enforced |
|---|---|---|---|---|---|
| Sign up (public form) | yes | yes (pending until approved) | no | no | `pages/api/auth/signup.ts`, `PUBLIC_SIGNUP_ROLES` |
| Change own password, sign out everywhere, own photo | yes | yes | yes | yes | `change-password.ts`, `logout-all.ts`, `upload/profile.ts` (own account only) |
| Onboarding / profile details | yes | no | no | no | `student/onboarding.ts` (`['student']`) |
| Raise own learning level | no (placement once, then course progress) | n/a | n/a | n/a | `lib/onboarding-input.js`, `lib/learning-level.ts` |
| Read enrolled lessons, take quizzes | own enrolments | own courses | all | all | `decideLessonRead`, `decideQuiz*` |
| Create / edit / delete courses, lessons, assignments | no | own courses only | all | all | `decideCourseUpdate`, `decideLessonUpdate/Delete`, `decideAssignmentGrade` |
| Review demo-trading submissions | no | tasks they assigned | all | not included (existing role list) | `demo-submissions/[id]/review.ts`, `demo-trading/tasks/[id]/submissions.ts` |
| User list (name, email, role, status only) | no | no | yes | yes | `pages/api/admin/users.ts`, `lib/admin-user-view.js` |
| Approve / reject registrations | no | no | no | yes | `lib/account-approval.js` (H3) |
| Grant or remove instructor / admin role | no | no | no | yes | `decideRoleChange` (H3) |
| Delete accounts | no | no | no | yes | `deleteAccount` (H3) |
| Suspend / reactivate accounts | no | no | no | yes | `changeAccountStatus` (this branch) |
| Purchase ledger, payment exceptions, audit log | no | no | no | yes | `superAdminOnly`, `withAuth(..., ['superadmin'])` |
| Platform analytics | no | own courses (`instructor/analytics`) | yes | yes | `admin/analytics.ts`, `instructor/analytics.ts` |

Never a target: the Super Admin account (approval, role change, deletion, suspension) and the caller's own account.

## 2. Account status model

| Status | Meaning | Set by | Can sign in, use API and sockets, use password reset |
|---|---|---|---|
| `approved` (or no status on older records) | active | signup (students), approval | yes |
| `pending` | registration awaiting decision | signup (instructors) | no |
| `rejected` | registration refused | Super Admin approval | no |
| `suspended` | access stopped | Super Admin (`PATCH /api/admin/users/:id`) | no; all sessions end when suspended |
| `deactivated`, `disabled`, `inactive` | recognised as inactive by `decideAccountAccess`; nothing sets them today | — | no |

Transitions implemented: `pending → approved | rejected` (H3), `approved → suspended → approved` (this branch). Each is audited in `adminAuditLog` with the actor, before and after, and (for suspension) the reason.

While suspended, an existing session is refused with 403 ("Account is not active"). The browser client signs out only on 401, so an open tab shows errors instead of returning to the sign-in page. A follow-up could treat that 403 as signed out.

**Decision (not built):** suspension durations, notification to the person, appeal process, self-service deactivation, and whether ordinary admins may suspend students.

## 3. User-linked data (code scan, not a database read)

Approximate map from the code that touches each collection (file-level: the field names appear in code that reads or writes the collection).

| Area | Collections | Links to the user | Personal data | Note for deletion |
|---|---|---|---|---|
| Identity | `users` | — | name, email, password hash, phone fields, `studentDetails` (date of birth, contact number, education, experience), photo URL and Cloudinary id | the record itself |
| Learning | `progress`, `quizScores`, `assignmentSubmissions`, `certificates`, `userBadges`, `challengeCompletions`, `demoTaskSubmissions`, `demoTrades`, `demoTradeJournal`, `demoAccounts`, `todos`, `reminders`, `notifications` | `userId` / `studentId` | answers, grades, journal text and screenshots | academic records: retention needs a decision |
| Teaching | `courses`, `lessons`, `quizzes`, `assignments`, `classes`, `demoTasks`, `instructors` | `instructorId`, `createdBy`, `assignedBy` | public profile (`instructors`) | deleting an instructor must not orphan courses students paid for |
| Community | `communityMessages`, `communityQuestions`, `communityReplies`, `communityVotes`, `communityNews`, `forumPosts`, `messages` | `senderId`, `authorId`, `userId` | message text, attachments, copied name and photo URL | others' threads reference these |
| Consultations | `consultationRequests`, `consultationSessions`, `consultationMessages` | `studentId`, `expertId`, `senderId` | messages, attachments, call metadata | two-party records |
| Payments | `paystackPaymentIntents`, `paystackPayments`, `coursePurchases`, `lessonPurchases`, `userCourseAccess`, `userLessonAccess`, `paymentExceptions` | `userId`, `paystackReference` | amounts, references (Paystack holds card data, not this app) | financial records: must be kept for the legally required period |
| Security and audit | `adminAuditLog` (append-only), `passwordResetSecurityLogs`, `passwordResetTokens`, `rateLimits` | actor / `userId`; HMAC keys in `rateLimits` | actor email in audit entries; deleted account's email in `account_deleted` entries; client IPs in security logs | audit must outlive the account |
| Files | Cloudinary folders `profiles`, `journal-screenshots`, `certificates`, `instructors`, `visual-aids`; local disk `public/uploads/community`, `public/uploads/consultations` | Cloudinary id on the record or in message documents | photos, screenshots, chat attachments | see section 7 |

Current deletion (H3, unchanged): the `users` document is hard-deleted and audited. Everything above stays, still pointing at the deleted id; Cloudinary files remain.

## 4. Account erasure and anonymization — Decision

Not implemented. A design that keeps financial and academic evidence:

1. A Super Admin marks the account `deletion_requested` (new status; sessions end; inactive everywhere).
2. After a review period chosen by the owner, an erasure job (run deliberately, not automatically): replaces name, email, phone fields and `studentDetails` on the `users` record with a tombstone (`deleted-<id>@invalid`, no password), keeps `_id`, role and dates; removes profile photo and journal screenshots from Cloudinary; removes or anonymizes community and consultation message text according to policy; keeps payment, enrolment, grade and certificate records linked to the tombstone `_id`.
3. Every step writes an audit entry; the job is idempotent and resumable.

Needed first: legal retention periods for payment and academic records (Nigeria's data protection law and tax rules at least), what happens to community posts and two-party consultation records, how long audit entries keep the email of a deleted account, and whether hard delete stays available at all.

## 5. Data export and privacy requests — Legal review

Not implemented. Proposed foundation once scope is agreed: `GET /api/account/export` for the signed-in person, returning their own records from section 3 with field allowlists (never other people's data inside shared threads, never password hashes, session counters, internal ids of others, payment provider secrets), rate-limited and logged; and a `privacyRequests` collection (type, status, requester, reviewer, timestamps) handled by the Super Admin with audit entries.

Needed first: which data is in scope, response time, identity checks for the request, format, and whether requests by email are accepted.

## 6. Support-assisted recovery — Decision

Not implemented, and there is deliberately no admin "set password" or "change email" capability. Self-service recovery is the email reset link. For people who lost access to their email, options:

- Super Admin verifies identity out of band (owner-defined checks, e.g. payment reference plus details only the person has), then sends a one-time reset link to a newly verified address. This needs the email-change verification flow (section 8) and an audited, Super Admin-only "start recovery" action that never reveals or sets a password.
- Or: no support recovery; the person creates a new account and purchases are moved by the owner (financial process).

Social-engineering safeguards for either: two-person rule or waiting period, notification to the old address, audit entry with the evidence used.

## 7. Files

- Profile photos (this branch): replaced or removed safely; storage failures are logged by account id and the cleanup can be repeated.
- Chat attachments are written to local disk under `public/uploads`. On Render the disk is ephemeral (files disappear on deploy), and Next.js serves only files present in `public/` when the app was built or started, so attachments may not be reachable in production at all. Containment added on this branch: HTML, SVG, scripts and similar types are refused and stored names are random. **Decision:** move attachments to Cloudinary (or another store) with access checks for consultation files.
- Account deletion does not remove Cloudinary files (section 4).

## 8. Sessions, email verification, email change, Google sign-in — Decisions

- **Sessions now:** 7-day JWT in `localStorage`, bound to `sessionGeneration`. Ended by: password reset, password change (other devices), sign out everywhere, suspension. Sign-out syncs across tabs. Not possible without a session store: ending one specific device.
- **Refresh tokens:** would mean short access tokens plus an `httpOnly` refresh cookie, a session collection (per-device revocation, rotation and reuse detection), CSRF protection for the refresh endpoint, cross-site cookie settings between Vercel and Render, and a migration that signs everyone out once. Worth it mainly to take the long-lived token out of `localStorage`. **Decision.**
- **Email verification:** today an account works immediately with an unverified address. Making it mandatory changes signup for students (blocked until verified) and interacts with instructor approval; making it optional (banner, required before email change or recovery) is lower risk. Would reuse the reset-link token store pattern and Resend. **Decision.**
- **Email change:** no route exists (safe). If wanted: re-enter password, verification link to the new address, notice to the old address, unique-email check at confirmation time. **Decision.**
- **Google sign-in:** not present. Requirements if wanted: verified Google email only, link to an existing account only after the person signs in with their password, never auto-link by email alone, same status checks as password login. **Decision.**

## 9. Browser hardening

- Headers on every response (`next.config.js`): `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`, HSTS one year, camera and microphone for this site only.
- Not yet: a script/style CSP. Next.js inline scripts need nonces, and the site loads Paystack, Google Fonts, ads (AdSense, PropellerAds), YouTube, Agora and Cloudinary. Recommended rollout: `Content-Security-Policy-Report-Only` with a reporting endpoint, observe for a release, then enforce.
- HTML sanitizer (`lib/html-sanitizer.ts`): fixed a loop that skipped the element after each removed one, strict URL schemes, `rel="noopener noreferrer"` on new-tab links, and markup is escaped when there is no DOM. It remains a custom sanitizer; DOMPurify would be more robust (dependency decision).

## 10. Dependency audit (30 October 2026, `npm audit`)

0 critical, 0 high, 2 moderate, 1 low. `quill@1.3.7` (via `react-quill@2.0.0`, moderate, XSS in the editor; editor is staff-only and its output is sanitized on display; no non-breaking fix offered). `deepmerge@4.3.1` (via `react-player`, low, prototype pollution; fix available). No dependency was changed on this branch.

## 11. Production data facts (read-only, counts only, 30 October 2026)

59 users; 0 duplicate emails exactly or after trimming and lower-casing; 1 address stored with upper case or spaces (that account cannot sign in, since login looks up the lower-cased address); 1 address with an invalid format; 2 Super Admin accounts; 1 admin with no status field; 11 students without a learning level.

**Owner actions:** decide how to correct the two address records; then build a unique index on `users.email` (signup's duplicate check is not atomic without it).
