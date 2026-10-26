# Error-handling security audit

Date: 26 October 2026. Static review of `pages/api`, `lib`, `server.js`, and the client API path. Unit tests only. No browser pass, no production data, and no production writes. Release status stays **BLOCKED**.

## Contract

`lib/public-error.js` is the shared contract.

Unexpected failures return:

```json
{ "error": "Something went wrong. Please try again later.", "code": "INTERNAL_ERROR", "requestId": "<16 hex chars>" }
```

The server log line is `[requestId] operation failed ErrorName code`. It does not include the exception message, stack, request body, or connection string. Logs go to the process stdout. This workspace does not control who can read that stream on Render.

Expected responses keep their existing status and a short `error` string. The client mapper in `messageFromUnknown` keeps those short messages. It replaces status 500 bodies, Axios “Request failed with status code …”, and text that looks like a database error, token, filesystem path, or connection string.

`lib/api-client.ts` writes that safe sentence onto `error.message` and `response.data.error` before a page reads it. It removes `details` and `stack`, and removes `message` on status 500.

## Findings

| Location | Risk | User impact | Remediation | Evidence |
| --- | --- | --- | --- | --- |
| Many `pages/api` catch blocks returned `error.message`, `errorMessage`, or `details: error.message` | High. Mongo, upload, and provider text could reach the browser | Developer errors in alerts and the Next overlay | Those responses now use `unexpectedBody`. A source scan fails if `error: error.message`, `message: errorMessage`, or `details: \`Missing:` returns | `tests/public-error.test.js` scan, pass |
| `pages/api/instructor/analytics.ts` returned `details: error.message` beside a generic error | High | Same | `details` removed. The catch no longer copies the exception | Source |
| Upload routes returned `details: Missing: CLOUDINARY_*` and logged whether secrets were set | High. Names the secret configuration | Support text plus a configuration map | Client receives only “Image upload service is not configured.” The log line does not list variable names | Source |
| `pages/api/ai/health.ts` returned model, token limit, temperature, key-prefix check, and `NODE_ENV` without auth | Medium. Configuration disclosure | Anyone who can call the route learns the AI setup | Response is `{ configured }` only | Source |
| `pages/api/auth/login.ts` logged the email and used two different 401 sentences | Medium. Account enumeration and personal data in logs | A missing account and a wrong password were distinguishable | Both cases return “Invalid email or password. Please check your credentials.” The log does not include the email | Source. Behavior change is limited to the message and the log |
| `pages/api/auth/reset-password.ts` returned 404 “User not found” after a valid-looking ticket | Low. Differs from the invalid-session response | Reveals that the account row is gone | Same 400 sentence as an invalid reset link | Source |
| `pages/api/auth/forgot-password.ts` stored `err.message` on the reset log and, in development, returned `_devNote` naming SMS env vars | Medium. Provider text and config hints | The public body was already generic | Log detail is `sms_send_failed`. The client note was removed | Source |
| `server.js` logged `error.message` for room seeding, the request URL, and the Next prepare error | Medium. A driver error can include a URI. A URL can carry a token | Server logs only | Those lines no longer include the exception or the URL | Source |
| Client pages used `error.message` and `response.data.error` directly | High if the API leaked | Alerts showed raw text | The API client rewrites the message before the page reads it | `messageFromUnknown` tests |
| Socket.IO `error` events | Already fixed strings from `lib/account-access.js` for auth and room decisions | Access denied stays generic | Not rewritten in this pass | Existing socket tests still pass |
| Signup “User already exists” and “This phone number is already registered” | Low enumeration on registration | The person could tell which value was already taken | Both collisions now return the same 400. No account is created. A successful signup is still 201 | `tests/error-closure.test.js` |
| API catch blocks that returned a fixed “Internal server error” or “Failed to …” without a request id | Low. No exception text, but no correlation id | Support could not match a report to a log line | Those catch blocks now use `unexpectedBody`. Expected 400, 401, 403, and 404 responses stay as they were | Source scan in `tests/error-closure.test.js` |

## Logging

Stdout only. A failure log from `logUnexpected` is the request id, operation name, error name, and error code. It does not include the exception message, stack, request body, password, token, authorization header, or connection string. Connection and signup logs no longer include the email address. The startup log no longer prints an API-key prefix. Cloudinary configuration and upload failures no longer print secret lengths or the provider error object. Room seeding no longer logs the thrown value. This does not make the host log store private. Render log access, retention, and who can read the stream were not reviewed. The service owner needs to check those controls on the host.

## Closure pass

Signup email and phone collisions return the same 400: “An account could not be created with those details. If you already registered, sign in.” Status 400 means the account was not created. Status 201 still means it was. Missing fields, an invalid phone, an invalid role, and a short password stay specific and do not repeat the submitted email or phone.

Forgot-password still returns “If an account exists for that number, a verification code was sent.” The response no longer adds `cooldown` or `rateLimited`, which previously appeared only for an existing account. The server still applies the cooldown and the hourly limit. Verify-password-otp uses “Invalid or expired code. Request a new code.” for a missing account, a missing code, and an expired code. A wrong code or a lockout is returned only while a reset is already in progress, so the person who requested the code can retry. Reset-password still uses the invalid-link sentence when the account row is gone.

Login still uses one 401 sentence for a missing account and a wrong password. After the password matches, pending, rejected, and inactive accounts keep their distinct 403 sentences so the person knows why they cannot enter. That distinction is not an unauthenticated existence check. `/auth/me` and authorized staff user lookups still return “User not found” for a missing row. The caller is already authenticated.

`publicUploadFailure` keeps the file-size limit as a 400 and returns “Image upload service is not configured. Please contact support.” when Cloudinary is missing. The body does not include the provider payload, a filesystem path, or a credential. The unauthenticated Cloudinary and SMS configuration routes now return `{ configured }` only. Unexpected upload and API failures include `INTERNAL_ERROR` and a request id.

Socket.IO authentication still rejects with the fixed error “Authentication error”. Room denial stays “Access denied”, “Unable to join room”, or “Account is not active”. A consultation join failure stays “Failed to join consultation”. These decisions were tested in memory. No live socket connection was opened.

Authorization helpers in `lib/account-access.js` still return the fixed string “Internal server error” for a lookup failure. That string is the existing decision contract. It does not include exception text, and those responses do not add a request id. API catch blocks that used to return the same sentence now go through `unexpectedBody`.

The API client replaces a string error body as well as `response.data.error`. Call pages still read `error.message` after that replacement. Agora call failures no longer append the SDK message. Browser console calls that used to print the Axios error object now print a fixed label, so the authorization header is not written to the browser console.

## Tests

| Command | Result |
| --- | --- |
| `npm test` | Exit 0. 189 passed, 0 failed. Unit tests only. Includes the closure cases for signup, uploads, synthetic leakage, and socket decisions. Not browser tests and not database integration tests. |
| `npx tsc --noEmit --incremental false --pretty false` | Exit 0. Re-run after the console-label cleanup also exited 0. |
| `node --check server.js` | Exit 0. |
| `npx eslint --quiet` on `lib/public-error.js`, `lib/signup-conflict.js`, `lib/api-client.ts`, `lib/cloudinary.ts`, the auth and upload config routes, `components/AgoraCall.tsx`, and `hooks/useAuth.tsx` | Exit 0. No errors. |
| `npm run build` | Not run. The development server is using `.next`. |

## Not verified

- Live login, reset, upload, and socket failures in a browser.
- A live Socket.IO connection.
- Render log access controls and retention. The owner must check who can read the service logs and how long they are kept.
- Timing differences between an existing and a missing account on signup and password reset. The responses match. The work time can still differ.
- Operator scripts under `scripts/` and `seed/` that are not started by `server.js`. Some still pass an error object to `console.error` if someone runs them directly.
