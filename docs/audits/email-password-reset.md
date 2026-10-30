# Password reset by email (replaces SMS codes)

Branch `feat/email-password-reset`, based on `1476cdb` (H3). Nothing here has been deployed; no production setting, index or role has been changed.

## What changed

- `POST /api/auth/forgot-password { email }`: every valid address gets the same 200 response, never sooner than 1.2 s. A link is emailed only when exactly one active account has that address. 400 for a malformed address; 429/503 from the rate limits.
- `POST /api/auth/reset-password { token, password }`: the link works once, for 30 minutes, for an active account whose sessions have not changed since the email. Success stores a bcrypt hash, raises `sessionGeneration` (all sessions end) and emails a "password changed" notice. Refusals are 400 with `invalid_token`, `expired_token`, `used_token`, `superseded_token` or `weak_password`.
- Password rule: at least 8 characters, at most 72 bytes (`lib/password-policy.js`).
- `POST /api/auth/verify-password-otp`, `/api/auth/update-phone` and `/api/auth/check-email-config` return 410 Gone (`phone_reset_retired`).
- Links: 256-bit random token, base64url, in the URL fragment (`/reset-password#token=…`). Only the SHA-256 hash is stored, in `passwordResetTokens`. Requesting a new link replaces the old one. If the email cannot be sent, the new link is deleted.
- Rate limits: request 10 per address / 5 per email / 300 service-wide per 10 minutes plus one email per address per minute; completion 10 per address / 5 per link per 10 minutes. Shared through MongoDB when `SHARED_RATE_LIMIT=mongodb`.
- Logging: no recipient, link, token, key or provider message is logged. `passwordResetSecurityLogs` holds event names, account ids, client addresses and reason codes.
- Stored phone numbers, `passwordPhoneResets` and the legacy `passwordResets` collection are left untouched.

## Settings (`lib/email.ts`)

| Variable | Production | Development |
|---|---|---|
| `RESEND_API_KEY` | required | without it nothing is sent |
| `RESEND_FROM` | required; an address on a domain verified in Resend; `@resend.dev` is refused | defaults to `onboarding@resend.dev` (delivers only to the Resend account owner) |
| `APP_BASE_URL` | required; `https://` origin, no path | defaults to `http://localhost:3000` |

If production settings are missing or invalid, forgot-password still answers normally, creates no link and sends nothing; the reason is logged as a code (`reset_email_not_sent` in the security log, `email_not_sent` on the console).

## Before deploying (owner)

1. **Sending domain.** Verify a domain in Resend (SPF/DKIM) and choose `RESEND_FROM`. Until then, production cannot send reset email; with this code deployed, nobody can reset a password by themselves, which is no worse than the current SMS flow (the 28 October backup had no `passwordPhoneResets` collection, so no reset code had been delivered by then).
2. **App role.** `passwordResetTokens` (find, insert, update, remove) was added to `lib/app-database-role.js`. Apply the same grant to `forexorbitAppRole` in Atlas **before** deploying, then confirm with `node scripts/check-db-role.js`. Without it every reset request that reaches an active account fails with 500.
3. **Indexes.** As an administrator, inspect and then build T1–T3:
   `node scripts/password-reset-indexes.js --database Forex_elearning --confirm-production Forex_elearning`
   then the same with `--apply`. The code works without them; T2 enforces one live link per account and T3 removes old links.
4. **Settings.** Set `APP_BASE_URL`, `RESEND_API_KEY` and `RESEND_FROM` on Render, and on Vercel if it serves `/api`.
5. **Controlled test.** One reset on a test account: email received, link opens the page, password changes, old session is signed out, link cannot be reused.

## Not done here

- No unique index on `users.email`: waits for a separate read-only duplicate check. Until then an address shared by two accounts sends nothing (logged as `ambiguous_email`).
- `twilio` and `libphonenumber-js` are still dependencies, and `lib/phone.ts` remains; remove them in a follow-up once the 410 period ends.
- Old collections (`passwordPhoneResets`, `passwordResets`) are not dropped.
