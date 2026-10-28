# Plan: one genuine Paystack test-mode webhook delivery (not executed)

Status: **plan only.** No tunnel has been opened, the Paystack dashboard has not been changed, no test event has been sent, and no checkout was made for this plan. Each step marked **approval** needs explicit owner approval first.

Purpose: prove what the handler-level tests (`tests/paystack-webhook-handler.test.js`) can't. That means:
- Paystack's real signed delivery reaches `pages/api/paystack/webhook.ts` running inside the real development server (`node server.js`);
- the signature verifies with the configured test secret;
- the event is processed against the isolated `Forex_elearning_dev` database.

## 1. Endpoints

| Item | Value |
|---|---|
| Local route | `http://localhost:3000/api/paystack/webhook` (`server.js` listens on `localhost:${PORT:-3000}` when `NODE_ENV` is not `production`) |
| Method and headers | `POST`, `x-paystack-signature` (HMAC-SHA512 of the raw body with the test secret key) |
| Public tunnel URL format | Cloudflare quick tunnel: `https://<random-words>.trycloudflare.com/api/paystack/webhook`. ngrok: `https://<id>.ngrok-free.app/api/paystack/webhook`. The hostname changes each time a tunnel starts. |
| Tunnel tool | None installed (`cloudflared`, `ngrok` and `lt` not found). Prefer `cloudflared`: no account is needed for a quick tunnel and it doesn't store request bodies. The ngrok inspector (`127.0.0.1:4040`) keeps full request bodies, including customer email, so don't use it. |
| Webhook-only forwarder | `scripts/webhook-only-forwarder.js` listens on `127.0.0.1:3901`. The tunnel points at it, not at the dev server. Only `POST /api/paystack/webhook` is passed to `localhost:3000`; any other method or path gets 404 without reaching the app. Only the body, `content-type` and `x-paystack-signature` are passed on, so cookies and `Authorization` from the public side are dropped. It keeps the same 256 KB cap and logs only method, status and whether it forwarded. Covered by `tests/webhook-only-forwarder.test.js` (9 tests, mock servers on loopback only). The 28 October hardening added: refusal of non-loopback targets, a fixed `127.0.0.1` bind, early 413 on a declared oversize body, 504 after a 15 s upstream timeout, request timeouts, 400 for malformed requests, and relaying only the upstream status, `content-type` and body. It has not been run against the dev server; that is step C3. |

`server.js` passes requests to Next unparsed, `middleware.ts` doesn't read the body, and no feature flag blocks `/api/paystack/*`.

## 2. Prerequisite validation (27 October 2026, read-only)

| Prerequisite | Result |
|---|---|
| `.env` in use (no `.env.local`) | Yes |
| Paystack secret and public keys | Both **test** (`sk_test_`, `pk_test_`) |
| `NODE_ENV` | Unset (development) |
| `MONGODB_DB_NAME` | `Forex_elearning_dev` |
| `decidePaymentEnvironment(.env)` | `enabled`, mode `test` |
| `connectionStatus` with `showPrivileges` | One user, `forexorbit_dev`, only `readWrite@Forex_elearning_dev`; isolation verified |
| Dev server | Listening on `localhost:3000` (`npm run dev`) |
| Webhook route under the real dev server | An unsigned local `POST {}` to `http://localhost:3000/api/paystack/webhook` returned **401**. The dev log shows `[payments] webhook { supportId, code: 'invalid_signature' }`. The request was refused before the database was opened. This proves the route is reachable and payments are enabled (otherwise 503). It is **not** a Paystack delivery. |
| Dev payment data ("before") | Intents 5 (all `paid`), payments 5, course access 5, purchases 5, payment exceptions 0, audit entries 0, webhook-sourced payments 0 |
| Fixtures | 8 courses; the one existing buyer owns 5, leaving 3 unowned; 29 other demo students own none; 35 lessons; 7 quizzes; 1 demo Super Admin |
| Tunnel tool | **Missing**; installing one needs approval |
| Paystack dashboard account match | **Not yet checked**; needs the owner at the dashboard (B below) |
| Re-check, 27 October 2026 (later run) | Isolation verified again. All 14 collections had identical counts and content hashes before and after the read-only browser checks. Payment data is unchanged: intents 5, payments 5, access 5, purchases 5. The payment exceptions and purchase audit collections don't exist yet (0 rows). |
| Test candidates (masked) | Student `…bec3`: demo, `status: approved`, owns no course (29 such students). Course `…beea`: 5 lessons, no owners, quiz on paid lesson `…bf05`. Fallback course `…bee6`: 6 lessons, no owners, quiz on paid lesson `…beef`. The existing buyer is `…bee0`; don't use that account. |

## 3. Execution checklist

Run top to bottom. Stop at any failed check. Lines marked **write** change the dev database. Lines marked **approval** need explicit owner approval before they run.

**A. Immediately before (read-only)**
- [ ] A1. Re-run the isolation check (section 2). **Stop** unless it reports `forexorbit_dev` with only `readWrite@Forex_elearning_dev`, test keys, and `NODE_ENV` unset.
- [ ] A2. Record the "before" counts: intents, payments, course access, purchases, payment exceptions, audit entries, and webhook-sourced payments. Also save a snapshot of every collection's count and content hash, so H1 can show nothing else changed. This is the same read-only method used on 27 October; it prints no values.
- [ ] A3. Use student `…bec3` and course `…beea`, or the fallback course `…bee6` (section 2). Re-check that neither has gained an access row. Record only masked ids (last four characters).
- [ ] A4. Use a fresh browser profile, or confirm `localStorage` has no `forexorbit:pendingCourseCheckout:<courseId>` key. The unlock component re-confirms a saved reference (kept for 24 hours) automatically on load, which calls the pay route.

**B. Confirm the test account and secret (owner at the dashboard)**
- [ ] B1. In the Paystack dashboard switch to **Test mode**, then open *Settings → API Keys & Webhooks*.
- [ ] B2. Compare the last four characters of the **test public key** with the local key. They must match. To print only the mode and last four locally:
  `node -e "const k=(require('dotenv').parse(require('fs').readFileSync('.env')).NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY||'').trim(); console.log(k.startsWith('pk_test_')?'test':'NOT TEST', k.slice(-4))"`
- [ ] B3. Don't copy or display the secret key. The signing secret is proven by the first real delivery: `granted` or `already_processed` means it matches; `invalid_signature` means it doesn't (stop and fix).
- [ ] B4. Note the current **Test Webhook URL** exactly, or that it is empty. Don't open or edit the Live fields.

**C. Minimal exposure** (**approval**)
- [ ] C1. Run `node --test tests/webhook-only-forwarder.test.js`. It uses mock servers only. All 9 tests must pass.
- [ ] C2. In a dedicated terminal start the forwarder: `node scripts/webhook-only-forwarder.js`. Expect `127.0.0.1:3901 -> localhost:3000/api/paystack/webhook (POST only)`.
- [ ] C3. **Local check before any tunnel**, from this machine only:
  - `netstat -ano | findstr :3901` shows `127.0.0.1:3901` and nothing on `0.0.0.0` or `[::]`;
  - `GET http://127.0.0.1:3901/` returns 404;
  - an unsigned `POST http://127.0.0.1:3901/api/paystack/webhook` with `{}` returns 401, with a dev-log `invalid_signature` line.

  Stop if any result differs.
- [ ] C4. Install `cloudflared`.
- [ ] C5. In a second dedicated terminal start `cloudflared tunnel --url http://127.0.0.1:3901`. **Never** point it at `localhost:3000`. Note the hostname. Don't use a named or persistent tunnel. Keep the window short (target under 15 minutes) and don't share the hostname.
- [ ] C6. Probes through the tunnel prove the app is not publicly reachable:
  - each of `GET https://<host>/`, `/login`, `/courses`, `/admin/purchases`, `/api/auth/me`, `/api/courses` and `/_next/static/` must return **404** from the forwarder;
  - `GET https://<host>/api/paystack/webhook` must return 404;
  - only `POST https://<host>/api/paystack/webhook` with `{}` returns **401**, with a dev-log `invalid_signature` line.

  If any app page, JSON or asset is served through the tunnel, **stop**: go to G1 and don't change the dashboard.

**D. Point Paystack at the tunnel** (**approval**)
- [ ] D1. In Test mode only, set the Test Webhook URL to `https://<host>/api/paystack/webhook` and save.

**E. One controlled test checkout** (**approval**, **write**)
- [ ] E1. Sign in as the chosen demo student and enroll in the chosen course if needed (**write**: enrollment).
- [ ] E2. Click Unlock and pay with a Paystack **test** card. **Write:** one intent, then one payment, one access row and one purchase row.
- [ ] E3. Watch the dev log for `[payments] webhook { event: 'charge.success', reference: …, code }`, with HTTP 200 in the tunnel output. The code is `granted` (webhook first) or `already_processed` (browser confirmation first). Both are correct.

**F. Evidence without secrets**
- [ ] F1. Record:
  - the masked reference (`fo_c_…abcd`);
  - the webhook HTTP status and code;
  - the browser confirmation code;
  - timestamps;
  - the Paystack dashboard's delivery status for the transaction, checked visually.
- [ ] F2. Don't record emails, names, card data, keys, tokens, or request bodies. Don't save tunnel output that contains bodies.

**G. Restore** (covered by the D approval)
- [ ] G1. Stop the tunnel (Ctrl+C) right after F1, then the forwarder. Confirm nothing listens on port 3901, no `cloudflared` process remains, and the tunnel hostname no longer answers.
- [ ] G2. Restore the Test Webhook URL noted in B4, or clear it. Confirm the Live settings are unchanged.
- [ ] G3. Uninstall `cloudflared` if it isn't wanted.

**H. Reconcile the dev records (read-only)**
- [ ] H1. "After" counts. Expect intents +1, payments +1, access +1 and purchases +1. Payment exceptions should be unchanged, unless unrelated test events from the same Paystack account arrived (each would be review-only `no_matching_intent` or `unreconciled_charge`).
- [ ] H2. For the new reference:
  - intent `paid`;
  - payment amount 1,000,000 kobo, NGN, `entitlementApplied: true`, `source` either `checkout` or `webhook`;
  - an access row with `entitlementType: paid_course`;
  - no `late_conflicting_event` exception.
- [ ] H3. Compare the A2 snapshot. Only the four payment collections (plus enrollment, if E1 enrolled) may differ. Record any other changed collection, and any extra exception rows, as unexpected. Don't delete them without approval.
- [ ] H4. Record the outcome in `consolidated-pre-release-remediation.md` section 2a, kept separate from the handler-level evidence.

## 4. Avoiding unintended writes or grants

- **Only the isolated dev database can be written.** `forexorbit_dev` has no privileges elsewhere. The route refuses a live key outside production, the shared database, and (since 27 October) a test key in production.
- **Test events never grant without a matching checkout.** A test event grants nothing unless its reference matches a pending checkout the app created for that student and course, at ₦10,000 NGN. Anything else is ignored or recorded for review. A later event that conflicts with a verified payment is recorded as `late_conflicting_event` and changes nothing.
- **Other projects on the same test account.** If the Paystack test account is shared, their events during the window can add review-only exception rows. Keep the window short.
- **No other activity during the test.** No refunds, disputes, transfers or other dashboard actions.

## 5. Approvals required before execution

1. Install and run `cloudflared` and the forwarder, publicly exposing only `POST /api/paystack/webhook` for the session (C).
2. Change the Paystack **test-mode** webhook URL, then restore it (D, G).
3. One test-mode checkout writing one enrollment (if needed) and one set of payment rows to `Forex_elearning_dev` (E).
4. Acceptance that unrelated test events on the same Paystack account during the window may add review-only exception rows (H3).
