# Release readiness — 26 October 2026

A local Git repository was created in this follow-up on branch `release-readiness/sprint-3-remediation`. It has no commit and no remote. Nothing was pushed. Release decision: **BLOCKED**.

## Gates

| Gate | Status | Evidence | Owner | Next action |
| --- | --- | --- | --- | --- |
| Damian25 deletion, operator-reported versus independently verified | UNVERIFIED | The operator reports that `Damian25` was manually deleted. No deletion time was supplied. This workspace has no Atlas CLI and no Atlas API key, so the user list was not read. `forexorbit_app` was not changed. | Atlas organization owner | Confirm in the Atlas project that `Damian25` is absent, and record the deletion time. Leave `forexorbit_app`. |
| Forensic evidence preserved and hash verified | PASS | Before the Sprint 3 cache removal, the external copy was present, 79,220,417 bytes, SHA-256 `412B282B69B6C1B037137EA4AD850031CD0B60F891CAB0B42549F85E47D65C60`. It was not deleted. A second read after the final build was not completed. The build command did not take that path. | This workspace | Keep the external copy. |
| Workspace `.next` cache removed safely | PASS | Only `C:\Users\Juliet\Downloads\forexorbit_academy-master\.next` was removed, after no project `node server.js` was listening and port 3000 was free. It was removed again before the final Sprint 3 build. Source, lockfile, `.env`, and the external copy remained. | This workspace | None. |
| Clean production build passed | PASS | Final `npm run build` (`next build`, Next.js 15.5.28) exit 0. Compile phase succeeded in 47 seconds. Node v22.19.0. The build log contains 607 `Warning:` lines and the build continued. | This workspace | Do not deploy this output. |
| New build output scanned for credential leakage | PASS | Final build: 86 scheme mentions across 6 files. 0 matches contained userinfo. Two unique strings, lengths 10 and 14, SHA-256 `5f37d5a9f6bf96c62e4ae0f02911ab4841ee1ab24739082100a700cb30488ffd` and `d954d719505f93418ad5b3023671a30365dfa264e7e79d7a0412f3d298850457`. | This workspace | None. |
| Render runtime identity | UNVERIFIED | The operator reports the saved URI uses `forexorbit_app`. This environment has no Render CLI, API token, or service id. The process user and restart time were not read. Render was not restarted. | Render operator | Record the service, the deploy time after the URI save, and a log that the process selected `Forex_elearning` as `forexorbit_app`. Do not paste the URI. |
| Eight smoke tests | UNVERIFIED | No isolated database, no disposable accounts, and no browser runner. All eight checks below are UNVERIFIED. | Test operator | Approve disposable fixtures, then run the browser list. |
| Unit, type, syntax, and lint | PASS | Follow-up `npm test`: 171 passed, 0 failed, exit 0. `npx tsc --noEmit --incremental false --pretty false`: exit 0. `node --check server.js`: exit 0. Sprint 3 `npx eslint --quiet`: 0 errors, exit 0. | Local workspace | Re-run after the next source change. |
| Three moderate advisories resolved or explicitly risk-accepted | BLOCKED | `npm audit` exit 1: 3 moderate, 0 high, 0 critical. `postcss-selector-parser@6.1.2`, `quill@1.3.7`, and `react-quill@2.0.0` remain. No owner risk acceptance is recorded. `npm audit fix` was not run. | Dependency owner | Accept the three findings or approve a compatible upgrade plan. |
| No unauthorized production writes or deployment | PASS | No deploy, seed, migration, Render change, password reset, course edit, progress deletion, unique index, notification fan-out, or evidence deletion. | This workspace | Keep that constraint. |

## Post-revocation verification

Operator report: `Damian25` was manually deleted. Cache removal was approved. `forexorbit_app` must remain. The external forensic copy must remain. Production deployment is not authorized. No deletion timestamp was provided, and none is invented here.

Local environment boolean, without printing the URI: dedicated user `forexorbit_app` yes, `Damian25` no, database name `Forex_elearning` yes, scheme `mongodb+srv` yes, JWT secret present yes. That is the local file only.

Two project development servers were identified from `npm run dev` in this workspace. A non-force stop was refused by Windows. The processes were then stopped. Port 3000 was free before `.next` was removed. The local server was not restarted by that build. A later `npm run dev` is listening on port 3000. During startup the development webpack cache reported missing pack files. Later `/api/auth/me` returned 200. A second production build was not started while that server is using `.next`.

`render.yaml` build command is `npm install && npm run build`. The command run here was `npm run build`, which is the repository `build` script (`next build`). `package.json` does not pin a Node engine. The installed Node is v22.19.0. `resend@6.13.0` requires Node `>=20`.

The new workspace pack is a different file from the preserved evidence: 120,110,904 bytes, SHA-256 `337BF0B6142B29477F9144BB3EB1014737909B7EB0BAEE70A4EAEDB7CA7F83CB`.

The product owner accepted the withdrawn-enrollment policy on 26 October 2026. That acceptance is recorded in `docs/audits/full-functional-audit/12-sprint-3-functional-remediation.md`. It does not authorize an index migration or a deployment. The `(userId, courseId)` and `(userId, dedupeKey)` unique indexes remain unapplied. Reminder scheduling still needs an operator job outside this workspace. Eight smoke tests remain UNVERIFIED. Three moderate advisories remain without risk acceptance.

Scheme-only matches were in:

- `.next/cache/webpack/server-production/0.pack`
- `.next/server/chunks/1415.js`
- `.next/server/pages/api/auth/forgot-password.js`
- `.next/server/pages/api/auth/reset-password.js`
- `.next/server/pages/api/auth/signup.js`
- `.next/server/pages/api/auth/verify-password-otp.js`

## Atlas confirmation still required

1. Open Database Access for the project that owned the exposed credential.
2. Confirm `Damian25` is absent. Do not change `forexorbit_app`.
3. Record the deletion time. Do not paste passwords.
4. That record is the independent revocation evidence. The operator report alone does not close the gate.

## Dependency decisions

Installed and verified:

- `resend@6.13.0` replaces `6.9.4`. It is the first 6.x release outside advisory range `6.2.0-canary.0`–`6.12.2`. Its dependencies are `postal-mime@2.7.4` and `standardwebhooks@1.0.0`. `emails.send({ from, to, subject, html, text })` is still the typed call used by `lib/email.ts`. `svix` and `uuid` are no longer in the lockfile. `npm audit` no longer lists `resend`, `svix`, or `uuid`.

Left unchanged:

- `postcss-selector-parser@6.1.2`, dev-only, via Tailwind 3.4.18 (`^6.1.2`) and `postcss-nested` (`^6.1.1`). `GHSA-w9m9-85wc-3x92` (`>=6.1.0 <6.1.3`) is cleared by `6.1.3`. `GHSA-rj75-hqrm-r3gf` (`<7.1.6`) is not. `7.1.6` is a new major against Tailwind 3 and was not installed. The parser runs at CSS build time. Application routes do not parse visitor CSS with it.
- `quill@1.3.7` through `react-quill@2.0.0`, used by `components/InstructorLessonEditor.tsx` and `components/RichTextEditor.tsx`. `GHSA-4943-9vgg-gr5r` covers every `quill` release `<=1.3.7`. Student pages render lesson HTML through `sanitizeForStudentView`. The server fallback strips script tags and inline handlers; it is not a DOM parser, and the editor itself still loads Quill. `npm audit fix --force` would install `react-quill@0.0.2`, an incompatible downgrade, and was not run. A later plan is to replace the editor with a maintained 2.x editor and retest lesson save and student display.
- `lib/email.ts` is not imported by a route. Password reset sends SMS from `pages/api/auth/forgot-password.ts`. The removed `uuid` path in `svix@1.86.0` was `v4()` with no caller-supplied buffer. `GHSA-w5hq-g745-h8pq` applies to v3, v5, and v6 when `buf` is passed. That call was not reachable, and the packages are now absent.

## Smoke checks

No browser runner is installed. `package.json` has no Playwright, Cypress, or Puppeteer dependency. No isolated test database and no disposable accounts exist. The local server now listening on port 3000 uses the shared `Forex_elearning` database, so it must not be used for these checks. These steps were not executed. Unit tests are not browser end-to-end results.

Fixtures that must be approved before any run: one active student, one inactive student, one second student, one instructor, one course, one lesson on that course, one enrollment for the active student only, one quiz with a stored answer key, one assignment with one submission owned by the first student, and one community room the member may join plus one room they may not join. Create them only in an approved isolated database. Do not create them in the shared `Forex_elearning` database.

| Check | Steps and expected result | Evidence to record | Smoke result |
| --- | --- | --- | --- |
| Login returns the disposable account's own identity | Sign in as the active disposable student. The response identity matches that account's id and role. | Account id, role, HTTP status. No password. | UNVERIFIED |
| An inactive disposable account is denied | Sign in or call a protected route as the inactive account. Access is denied. | Status and the fixed error body. | UNVERIFIED |
| An enrolled disposable student can open an assigned lesson | Open the enrolled course lesson as the active student. Lesson content is returned. | Lesson id, HTTP 200, content present. | UNVERIFIED |
| A non-enrolled disposable student is denied lesson access | Open the same lesson as the second student. The response is 403. | Status and error body. | UNVERIFIED |
| Student quiz responses hide answer keys | The enrolled student loads the quiz. The payload has questions and no correct-answer field. | Redacted response keys. | UNVERIFIED |
| One disposable student cannot read or submit another student's assignment | The second student requests and submits the first student's assignment. Both are denied. | Status codes. No submission row for the second student. | UNVERIFIED |
| A community member can access only an authorized room | Join the allowed room, then the other room. The first succeeds and the second is denied. | Room ids and decisions. | UNVERIFIED |
| Socket.IO connects to the same test environment's own host and enforces room authorization | Connect to that environment's host, not a hard-coded production host. An authorized room event is delivered and an unauthorized room event is not. | Host name, connection result, both room decisions. | UNVERIFIED |

## Follow-up verification

Commands run while the development server was already listening:

| Command | Exit | Result |
| --- | --- | --- |
| `npm test` | 0 | 171 passed, 0 failed. Runner duration about 5.0 seconds. |
| `npx tsc --noEmit --incremental false --pretty false` | 0 | No diagnostics. Combined with the server check, about 57 seconds. |
| `node --check server.js` | 0 | Syntax accepted. |
| `npx eslint` on the Sprint 3 files, `--quiet` | 0 | 0 errors. |
| `npm audit` | 1 | 3 moderate, 0 high, 0 critical. |

`npm run build` was not repeated. The previous build remains the production-build evidence. Rebuilding into the live `.next` directory would collide with the running server.

Source and build scan, without printing match text:

- Build output: 6 files, 0 userinfo matches. The same two scheme-only strings as the Sprint 3 scan, lengths 10 and 14.
- Source tree, excluding `node_modules`, `.next`, and `coverage`: the only non-placeholder credential-shaped URI is `.env`. Its username matches `forexorbit_app` and does not match `Damian25`. `.env` is ignored by `.gitignore`.
- Placeholder URI examples in `README.md`, `DATABASE_SETUP.md`, `ENV_SETUP_GUIDE.md`, `DEPLOYMENT_GUIDE.md`, and `TROUBLESHOOTING_NETWORK_ERROR.md` do not match the local user or `Damian25`.

No Playwright, Cypress, or Puppeteer package is installed. The running server uses the shared local database, so it is not an isolated smoke environment.

## Git preparation

`git init -b release-readiness/sprint-3-remediation` exit 0. Current branch: `release-readiness/sprint-3-remediation`. No commit. No remote. No push.

`git check-ignore` confirms `.env`, `.env.local`, and `.next` are ignored. `git status --short` lists the application, tests, and docs as untracked. There is no diff because there is no parent commit.

The initial commit and any push need explicit approval. Do not push to `main`. Before that commit, exclude generated output and keep `.env` untracked. `seed/seed.js` holds the demo seed password and must be reviewed before it is committed.

## Local build credential

A boolean read of the local environment, without printing the URI, reports: dedicated user `forexorbit_app` yes, `Damian25` no, database name `Forex_elearning` yes, scheme `mongodb+srv` yes. That is the local file. It does not prove the Render process.

## Error-handling pass

Recorded in `docs/audits/error-handling-security-audit.md`. Unexpected API failures that previously returned `error.message` now return a generic message, `INTERNAL_ERROR`, and a request id. Login no longer logs the submitted email, and the two 401 sentences are the same. This does not close any release gate above. `npm test` after this pass: 183 passed, 0 failed, exit 0. `npx tsc --noEmit --incremental false --pretty false`: exit 0. `node --check server.js`: exit 0. `npm run build` was not run while the dev server is using `.next`. Release decision remains **BLOCKED**.

## Error-handling closure

Recorded in `docs/audits/error-handling-security-audit.md`. Signup no longer says which of the email or phone is already registered. Unexpected API catch blocks now return a request id through `lib/public-error.js`. Configuration routes no longer name Cloudinary or SMS environment variables. This does not close any release gate. `npm test`: 189 passed, 0 failed, exit 0. `npx tsc --noEmit --incremental false --pretty false`: exit 0. `node --check server.js`: exit 0. `npm run build` was not run while the dev server is using `.next`. Release decision remains **BLOCKED**.

