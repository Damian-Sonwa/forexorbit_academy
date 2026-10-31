# Staging validation checklist

**Status: not started.** Every result column below is empty on purpose. Local results (headless Edge on `http://localhost`) are listed separately in `phase-4-5-closure.md` and do **not** count as staging results.

## Staging environment (decided: temporary Render Web Service, separate database)

Staging must use a different HTTPS origin and a database other than `Forex_elearning`, with its own database user. It runs the release build `release/phase-4-5`, which contains `f3e728a`, `7dca2c8`, `2f9e5ef` and the documentation commit. Delete the service and the staging database user after sign-off.

### Owner actions (this workspace has no Render, Atlas or GitHub account access)

1. **Publish the release branch for Render.** Push `release/phase-4-5` to GitHub as its own branch. This needs explicit approval: it is a push, though not to `master`. The repository is public, so the branch becomes visible.
2. **Staging database in Atlas** (Database Access):
   - Database: `forexorbit_staging`, on the existing cluster. It is created on first write.
   - Custom role `forexorbitStagingAppRole`: the production role shape applied to `forexorbit_staging`. Print it with:
     ```
     node scripts/check-db-role.js --database forexorbit_staging --print-role
     ```
     (no connection is made). This makes staging rehearse the production permissions, including `sessions`. The printed JSON is named `forexorbitAppRole`; create it in Atlas under the name `forexorbitStagingAppRole`, with database `forexorbit_staging`.
   - Database user `forexorbit_staging_app` with only that role, and a new generated password. **Never reuse the production user or password.**
   - Network Access: Render's outbound addresses are already allowed for production. Check that the cluster's IP access list covers the staging service as well.
3. **Session indexes on staging** (a rehearsal of the production step). Set the admin connection in the shell environment, not typed into a logged terminal, as `CERTIFICATE_INDEX_MONGO_URI`. Then:
   ```
   node scripts/session-indexes.js --database forexorbit_staging            # expect missing x3
   node scripts/session-indexes.js --database forexorbit_staging --apply    # expect Built: session_user, session_family, session_ttl
   ```
   The `--connection-file` option is reserved for `Forex_elearning` and refuses other databases.
4. **Render staging service.** Render → New → Web Service:

   | Setting | Value |
   |---|---|
   | Repository | `Damian-Sonwa/forexorbit_academy` |
   | Branch | `release/phase-4-5` |
   | Name | `forexorbit-academy-staging` |
   | Region | the production region |
   | Root Directory | blank |
   | Build Command | `npm install && npm run build` |
   | Start Command | `npm start` |
   | Health Check Path | `/api/health` |
   | Instance | the production instance type, so behaviour matches. A free instance spins down when idle, which would disturb the idle-timeout and socket tests. |
   | Auto-Deploy | on (for the release branch only) |

   Render shows the assigned URL, for example `https://forexorbit-academy-staging.onrender.com`; a suffix is added if the name is taken. **`APP_ORIGIN` must equal that exact URL.**
5. **Staging environment variables.** Set only these; nothing is copied from production:

   | Variable | Staging value |
   |---|---|
   | `NODE_VERSION` | `22.19.0` |
   | `APP_ORIGIN` | the staging URL from step 4 |
   | `APP_BASE_URL` | the same staging URL |
   | `MONGO_URI` | the `forexorbit_staging_app` connection string |
   | `MONGODB_DB_NAME` | `forexorbit_staging` |
   | `JWT_SECRET` | a **new** random value (for example `openssl rand -hex 48`), never the production secret |
   | `AUTH_LEGACY_BEARER_UNTIL` | unset, except during the one legacy-exchange test row below |
   | `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | **unset**. The start script forces production mode, where a test key is refused (`test_key_in_production`) and a live key is not allowed in staging. Checkout is therefore expected to answer 503 "not configured"; the payment logic itself is covered by the automated tests. |
   | `RESEND_API_KEY`, `RESEND_FROM` | **unset**. Production mode refuses Resend's test sender, so nothing is sent; reset-email rows are marked not testable. |
   | `CLOUDINARY_*`, `AGORA_*`, `AI_*`, `OANDA_*`, ads | unset. Production media and providers stay out of staging; uploads are expected to report "not configured". |
   | `SHARED_RATE_LIMIT`, `TRUSTED_PROXY_HOPS` | unset (defaults) |
   | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`, `ALLOWED_ORIGINS` | unset |
6. **Staging accounts.** These are synthetic: use addresses you control, or `@example.com` addresses, which receive nothing.
   - Students and instructors sign up through `/signup` on staging.
   - Admin and Super Admin: there is deliberately no creation script (`scripts/set-superadmin.js` is disabled). Sign the person up, then change `role` (`admin` or `superadmin`) and `status: "approved"` on that user in Atlas → Data Explorer → `forexorbit_staging.users`. That is allowed in staging only.
   - Add a pending instructor by signing up as an instructor.
   - Add a suspended student by having the Super Admin suspend one in the UI.
7. Wait for the health check to pass, and for the log line `✓ Trusted origins: <staging URL>`. Then run the checks below.

### Browsers available

- This workstation has Chrome and Edge only.
- Firefox must be installed for its rows.
- Safari macOS and iOS need an Apple device.
- Mark rows for an unavailable browser as **not run**, never as passed.

The automated scripts start their own local server and do not test a deployed URL. They already passed on the release tree. Everything below is done by hand on the staging URL.

## Results

Fill in Pass/Fail per browser:

- **Ch** = Chrome desktop;
- **FF** = Firefox desktop;
- **Sf** = Safari macOS;
- **iOS** = Safari on iOS;
- **Notes** = anything observed.

### Frontend

| Check | Ch | FF | Sf | iOS | Notes |
|---|---|---|---|---|---|
| Home page loads; no console errors about blocked requests | | | | | |
| `/login` and `/signup` load | | | | | |
| Direct load of a nested route (for example `/courses/<id>/lessons/<id>`) | | | | | |
| Refresh on a nested route keeps the page | | | | | |
| Assets load (DevTools Network: no 404 for `/_next/static`) | | | | | |
| No request goes to another origin for API or socket (DevTools Network: all `/api` and `/api/socket` on the staging origin) | | | | | |

### Authentication

| Check | Ch | FF | Sf | iOS | Notes |
|---|---|---|---|---|---|
| Sign in as each role | | | | | |
| Student registration signs in; instructor registration stays pending (no session) | | | | | |
| Reload keeps the session; closing and reopening the browser keeps it within 12 h | | | | | |
| Cookie `__Host-fo_session`: HttpOnly ✓, Secure ✓, SameSite Lax, Path `/`, no Domain, expiry about 12 h | | | | | |
| Rotation: after 15 min of use, the cookie value changes and the page keeps working | | | | | |
| Idle: after 31 min without requests, the next action goes to sign-in | | | | | |
| Absolute expiry: after 12 h, sign-in is required (or test on a staging DB by moving `absoluteExpiresAt` back) | | | | | |
| Sign out: the cookie is removed; Back does not restore access | | | | | |
| Sign out everywhere: other browsers are signed out | | | | | |
| Password change: this tab stays signed in; another browser is signed out | | | | | |
| Password reset by email link: not testable on staging (no email); covered by the automated tests | n/a | n/a | n/a | n/a | |
| Super Admin suspends a student: the student's open tab is signed out within 30 s; they cannot sign in again | | | | | |
| Role change: the user is signed out and signs in under the new role | | | | | |
| Two tabs: sign out in one and the other goes to sign-in | | | | | |
| Legacy exchange (**staging only**, `AUTH_LEGACY_BEARER_UNTIL` set there): a token placed in `localStorage.token` on the staging origin becomes a cookie session on load, the key is removed, and a second attempt fails. Unset afterwards: the route answers 410. | | | | | |

### Security

| Check | Ch | FF | Sf | iOS | Notes |
|---|---|---|---|---|---|
| Console: `document.cookie` does not contain `fo_session`; `localStorage` and `sessionStorage` have no `token`/`user` | | | | | |
| A form on another site POSTing to `/api/auth/logout` or `/api/progress` is refused (403) | | | | | |
| `curl -X POST <origin>/api/auth/login -H "Content-Type: application/json" -d '{}'` (no Origin or header) gives 403 | n/a | n/a | n/a | n/a | |
| `curl -H "Origin: https://evil.example" -i <origin>/api/auth/me` gives no `Access-Control-Allow-Origin` | n/a | n/a | n/a | n/a | |
| A suspended or pending account cannot reach any page data | | | | | |
| Admin cannot approve a registration (403); Super Admin can | | | | | |
| Staging logs contain no cookie values, tokens or passwords; API responses contain no token | n/a | n/a | n/a | n/a | |

### WebSockets

| Check | Ch | FF | Sf | iOS | Notes |
|---|---|---|---|---|---|
| Lesson chat and community rooms connect (DevTools: `/api/socket` WebSocket, status 101) | | | | | |
| A socket connection from another origin is refused (`sessions-e2e.js` covers this locally; on staging use a page on another origin) | | | | | |
| After sign-out elsewhere, the socket disconnects | | | | | |
| After a staging redeploy, sockets reconnect and the user stays signed in | | | | | |
| An idle-expired session's socket is closed within about 30 s | | | | | |

### Existing features

| Check | Ch | FF | Sf | iOS | Notes |
|---|---|---|---|---|---|
| Catalogue, enrolment, free preview, locked paid lesson | | | | | |
| Instructor: draft, lessons, submit for review; Admin: publish, archive | | | | | |
| Progress, and level advancement with a draft and an archived course present | | | | | |
| Archived course: open for an enrolled student; closed to new students | | | | | |
| Staff certificate issuance; duplicate refused | | | | | |
| Checkout answers 503 "not configured" (no Paystack key on staging, by design); unsigned `POST /api/paystack/webhook` gives 503 | | | | | |
| Forgot-password answers with the generic message; no email is sent (no Resend key on staging). Reset revocation is covered by the automated tests. | | | | | |
| Community rooms and chat | | | | | |
| Uploads report "not configured" without crashing (no Cloudinary on staging) | | | | | |

## Sign-off

Staging is accepted when every row is Pass in Chrome, Firefox and Safari (iOS where a device is available), or the failure is explicitly accepted by the owner. Record the build commit, the date and who tested.
