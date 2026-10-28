# Browser verification checklist (dev environment, not executed)

Status: **signed-out read-only checks done on 27 October 2026 (see "Read-only run"); everything else not run.** No browser automation framework is installed or proposed. These are manual steps on the local dev server (`http://localhost:3000`) against `Forex_elearning_dev`, signed in as the seeded `@demo.com` accounts. Steps marked **write** change the dev database. Steps marked **Paystack** contact Paystack in test mode. Both need owner approval.

Before every session: run the read-only isolation check in `paystack-test-webhook-delivery-plan.md` section 2. Stop unless it passes. Record masked ids only. Never record emails, names, card data or keys.

## Fixtures available (read-only count, 27 October 2026)

- 8 courses, 35 lessons, 7 quizzes.
- One demo student owns 5 courses; 3 courses are unowned by that student; 29 other demo students own none.
- One demo Super Admin.
- The first lesson of each course is free. Some courses have only one lesson and can't show a paid lesson, so pick one with at least two lessons and a quiz on a paid lesson.

## Checks

| # | Check | Steps | Expected | Writes / Paystack |
|---|---|---|---|---|
| 1 | Paid lesson is locked before purchase | As a student who does not own the course: enroll, open a paid lesson | Lock screen with price ₦10,000; no lesson body or media URL in the page or `/api/lessons/:id` response (403) | **write**: enrollment only |
| 2 | Successful payment unlocks immediately | Unlock → Paystack test card (success) | The modal closes; the page reports access without a refresh or second click. The dev log shows `init-course intent_created`, then `POST /api/courses/<id>/pay 200` with code `granted`, and no `POST /courses/<id>` | **write** + **Paystack**: one intent, payment, access and purchase row |
| 3 | Paid lesson and its quiz open | Open the paid lesson, then its quiz; submit answers | Lesson body loads. The quiz loads without answer keys, and grading happens on the server | **write**: quiz submission and progress |
| 4 | Ledger shows the purchase | As Super Admin open `/admin/purchases`, search the masked reference | Student, course, ₦10,000, both references, verified time; no warning | Read-only (listing may write a pending audit repair only if one exists; none expected) |
| 5 | Exception review | Open the Exceptions tab. If none exist, check the empty state only. Recording an outcome requires an exception row | Reason label, status, occurrences; saving a review shows history | Viewing: read-only. **Saving a review writes** the exception and an audit entry |
| 6 | Paystack comparison button | Purchase detail → "Paystack comparison" | Read-only provider comparison with warning codes | **Paystack** (verify API) and **write**: one audit entry |
| 7 | Abandoned checkout | Unlock → close the Paystack modal without paying | Button returns to idle; no access. Unlock again reuses the same pending checkout (no second intent) unless Paystack reports it abandoned, in which case it is superseded and a new one created | **write** + **Paystack**: intent rows |
| 8 | Failed payment | Unlock → Paystack test card that declines (from Paystack's test-card list) | Failure message; no access; the "Check payment status" button is offered only where retrying makes sense | **write** + **Paystack**: intent |
| 9 | Pending payment | No reliable way to make Paystack hold a test charge as pending from the browser | — | **Mock-only**: `course-purchase` and `course-checkout-unlock` tests cover pending and retry |
| 10 | Superseded checkout paid | Not reachable through the UI (the old reference isn't offered again) | — | **Handler-level only**: `paystack-webhook-handler` 7c and `course-purchase` superseded tests |
| 11 | Reload during confirmation | After paying, reload the course page within a few seconds | The saved reference is confirmed on load; access appears once; no duplicate rows | Same writes as check 2 (no extra rows) |
| 12 | Mobile and redirect | Repeat check 2 on a phone browser on the same network. The dev server listens on `localhost` only, so this needs either the tunnel (separate approval) or running the dev server bound to the LAN (configuration change, approval) | Modal works; no full-page POST; return parameters (`reference`, `trxref`) are cleaned from the URL | Same as check 2 |

## Read-only run, 27 October 2026 (signed out)

Run in the Cursor browser against the running dev server. Isolation was verified first. The browser had no session, no cookies and no `forexorbit:pendingCourseCheckout:*` key, so nothing could auto-confirm a checkout.

All 14 collections had identical counts and content hashes before and after. The dev log shows only `GET` requests in this window, with no `[payments]` lines.

| Check | Result |
|---|---|
| Course listing `/courses` | Renders all 8 courses with sign-in and sign-up links |
| Public `GET /api/courses` | 200 with 8 courses. No content, video, media, answer or email fields |
| Course detail `/courses/<id>` | Redirects to `/login`; course detail needs an account |
| Lesson page `/courses/<id>/lessons/<id>` | Redirects to `/login?next=…`; no lesson body or video rendered |
| `/dashboard` and `/admin/purchases` | Both redirect to `/login` |
| `GET /api/courses/<id>`, `/api/courses/<id>/lessons`, `/api/lessons?courseId=`, `/api/lessons/<id>`, `/api/quizzes/<lessonId>`, `/api/admin/purchases`, `/api/admin/payment-exceptions` | All 401 `Authentication required` |

**Still pending:**
- **All signed-in checks:** owned-course access, the paid lesson and its quiz as owner and non-owner, and the ledger as Super Admin.
  - Signing in means typing a demo password, and the agent must not read or handle secret values.
  - Signing in itself doesn't write: the login route has no database writes and the rate limiter is in-memory.
  - For an agent-run pass, the owner signs in manually in the Cursor browser tab, then hands over.
- **The `late_conflicting_event` label in the ledger UI.** It only shows on an exception row, and there are none. Creating one is a write, so this stays covered by `paystack-webhook-handler` test 7e, which checks the label the ledger returns.

**Read-only page loads for a signed-in pass:**
- the course listing and course detail pages (viewing only; don't click Enroll, Unenroll or "Fix payment");
- an owned course's paid lesson;
- a non-owned course's paid lesson, which shows the lock screen (it auto-confirms only when a pending-checkout key exists);
- `GET /api/quizzes/<lessonId>` for owned and non-owned paid lessons;
- the `/admin/purchases` listing and detail, and the Exceptions tab.

**Writes during a signed-in pass:**
- **Not every page load is read-only.** Finishing a video calls `updateProgress`. Opening the Exceptions tab runs an audit repair only when an exception has pending audit ids (none exist).
- Submitting a quiz writes.
- The "Paystack comparison" button calls Paystack.

**Observation:** in every signed-in tab, `components/Sidebar.tsx` polls `GET /api/auth/me` every 5 seconds and again on window focus. It's read-only, but it produced most of the dev-log lines in this window from another signed-in browser. Not changed.

## Signed-in read-only checklist (owner signs in personally)

Prepared 28 October 2026. The agent didn't sign in and has no password.
- Sign in yourself in a normal browser window.
- Keep DevTools open on the **Network** tab, filtered to `Fetch/XHR`.
- Every check below should show only `GET` requests, apart from the sign-in `POST /api/auth/login`, which doesn't write.
- If any other `POST`, `PUT` or `DELETE` appears, note it and stop.

**Before you start:**
- Make sure no address you open contains `?reference=` or `trxref=`.
- In DevTools → Application → Local Storage, confirm there is no `forexorbit:pendingCourseCheckout:*` key. If there is one, use a private window.
- A saved key or URL reference makes a locked lesson auto-confirm through `POST /api/courses/<id>/pay`, which can call Paystack in test mode.

**Accounts and fixtures** (masked):
- **Owner:** the existing buyer `…bee0`, who owns 5 courses. Use course `…bee9`; its paid lesson `…bf00` has a quiz.
- **Non-owner:** demo student `…bec3`, who owns nothing, on the same course `…bee9` and lesson `…bf00`.
- **Super Admin:** the demo Super Admin account.

| # | Sign in as | Do | Expected | Must not do |
|---|---|---|---|---|
| S1 | Owner | Open `/courses`, then the course `…bee9` detail page | The course shows as owned or enrolled with all lessons listed; no Unlock or price prompt | Don't click Enroll, Unenroll or "Fix payment" |
| S2 | Owner | Open paid lesson `…bf00` | The lesson body loads; `GET /api/lessons/<id>` returns 200 | Don't play the video to the end (finishing it writes progress) |
| S3 | Owner | Click **Take Quiz** on that lesson; look at the questions only | Questions show. In the Network response for the lesson (and `GET /api/quizzes/<lessonId>` if requested) there is no `correctAnswer` field | Don't select answers or click **Submit** (that writes a score and progress) |
| S4 | Sign out, then non-owner | Open the same lesson URL | Lock screen showing ₦10,000 and an Unlock button. `GET /api/lessons/<id>` returns 403, with no lesson body or media URL in the response | **Don't click Unlock** (it creates a checkout and calls Paystack) |
| S5 | Non-owner | Request the quiz directly: open `http://localhost:3000/api/quizzes/<lessonId>` in the address bar | 403 or a locked response; no questions or answers | Don't submit anything |
| S6 | Sign out, then Super Admin | Open `/admin/purchases` | The ledger lists the 5 existing purchases with masked references, ₦10,000 amounts and verified times | Don't add notes |
| S7 | Super Admin | Open one purchase's detail | Linked records and audit history display | **Don't click "Paystack comparison"** (it calls Paystack and writes an audit entry) |
| S8 | Super Admin | Open the **Exceptions** tab | The empty state shows (0 exceptions on 28 October) | Don't save any review |

**`late_conflicting_event` label:** not checkable in the browser right now.
- A read-only query on 28 October found no payment exceptions at all.
- Creating one would be a write, so this stays covered by `paystack-webhook-handler` test 7e, which checks the ledger's label text.
- If a real exception appears later (for example from the genuine webhook test), check its label in S8 then.

**After you finish:** sign out. Then ask for a read-only before-and-after snapshot comparison if you want proof that nothing changed. The agent can run that without signing in.

## Order and cleanup

1. Read-only first: checks 4 and 5 (viewing) on existing data.
2. One approved payment session: checks 1, 2, 3, 11, then 4 again for the new purchase.
3. Separate approval for checks 6, 7, 8 and 12.
4. Afterwards, record "after" counts read-only. Don't delete rows. Any cleanup of dev rows needs its own approval and a guarded script; none exists yet.
