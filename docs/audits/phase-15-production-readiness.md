# Phase 15: Security, performance, reliability and production readiness

- **Branch:** `feat/phase-15-production-readiness`, created from `f826241` (origin/master).
- **Worktree:** `forexorbit_academy-phase-15-readiness`.
- **Status:** not committed.
- **Verdict:** CONDITIONALLY COMPLETE. The dependencies are listed in section 11.

## 1. Baseline (verified, not assumed)

| Item | Finding |
|---|---|
| origin/master | `f826241` (Phase 14), preceded by `5f87ecc` (practical tasks), `b902c20` (Phase 13) and `d1bd4a2` (Phase 12). |
| Deployed | Phase 13, practical-task and Phase 14 routes answer 401 signed out on the Render URL, so `f826241` is live. `/api/health` is 200. |
| Owner's dev folder | `feat/phase-13-admin-portal` at `b902c20`, clean. |
| Uncommitted elsewhere | `feat/background-zigzag` (zig-zag background and hydration fix), 6 files in the phase-14 worktree. Not part of this phase. |
| CI | None existed. |
| Live headers | HSTS, nosniff, frame-deny and a minimal CSP were present. `X-Powered-By: Next.js` was exposed. |
| robots.txt and sitemap | Missing (`/robots.txt` returned 404). |
| Backups | The repository scripts produced type-losing JSON (see P1-3). The Atlas backup tier is unknown, because there's no access. |

Per-phase status for Phases 1–14:
- **Implemented, integrated, test-verified, deployed:** yes for all, on master.
- **Browser-verified:** only through headless layout checks.
- **Operationally verified:** health, signed-out route checks and live headers only. No signed-in production journeys were run, because that needs test accounts and approval.

## 2. Findings and fixes

| ID | Priority | Finding | Fix |
|---|---|---|---|
| P1-1 | P1 | The Phase 14 Resend webhook would be refused by the CSRF middleware (403 `origin_missing`), since providers send no Origin or CSRF header. Delivery tracking would never have worked. | Exempted in `lib/request-guard.js`; the route verifies its own Svix signature. Verified over HTTP: it now reaches the route and answers 503 (not configured). |
| P1-2 | P1 | Consultation and community chat attachments had three faults. Files were written to `public/uploads`, which Next.js doesn't serve after the build and Render loses on every deploy. Served files were public to anyone with the link. And files were stored before the uploader's access was checked, with a 50 MB cap and no rate limit. | Access is checked first. Files go to private Cloudinary storage and are read through `/api/attachments/<kind>/<id>`, which re-checks membership and redirects to a 5-minute signed link. The cap is 25 MB, with a rate limit and temporary-file cleanup. Older `/uploads/...` links are left as they are. |
| P1-3 | P1 | `scripts/backup-data.js` wrote plain JSON: ObjectId, Date and Decimal128 lost their types, and indexes weren't saved. `restore-data.js` wrote into `Forex_elearning` after `deleteMany({})` on every collection, with no confirmation. | `lib/db-backup.js` with `scripts/db-backup.js` and `scripts/db-restore.js`: canonical EJSON NDJSON streams, a SHA-256 per file, saved and recreated indexes, and refusal of the production name and of unsuffixed or non-empty targets. The old scripts now refuse to run. |
| P2-1 | P2 | A failed first database connection was cached forever: every request failed until a restart. Driver defaults made requests hang for 30 s when the database was unreachable. | `lib/mongo-options.js`: a failed attempt is forgotten so the next request retries. Server selection and connect time out at 10 s; pool 50 (configurable), idle 5 min. Recovery was observed in a production-mode run. |
| P2-2 | P2 | No rate limit on chat posting (community, consultation, lesson chat) or on profile and certificate uploads. | New `chatLimiter` (120 per window); `uploadLimiter` on those uploads. |
| P2-3 | P2 | No CI: nothing checked a change before Render deployed master. | `.github/workflows/ci.yml`: tsc, lint, the unit and route suite, `npm audit` (high fails), the build, all real-MongoDB suites on a replica-set container, and the restore drill. No deploy, no secrets. |
| P2-4 | P2 | The real-MongoDB suites had gone stale. They expected the indexes from before Phase 12 and before the trade reviews, and regrades without the Phase 12 reason. They skip without a test database, so nobody noticed. | Expectations updated (A7, T19/T20, `tradingReviews`, a regrade reason). Invariants unchanged: 143 of 143 pass on MongoDB 9.0.4. |
| P3-1 | P3 | No robots.txt, no sitemap, and private areas could be indexed. | Generated `/robots.txt` and `/sitemap.xml` (public pages and published courses). `X-Robots-Tag: noindex, nofollow` on every private prefix and `/api`. A default title and description. |
| P3-2 | P3 | `X-Powered-By` exposed; CSP limited to frame-ancestors, object-src and base-uri. | `poweredByHeader: false`. A full restrictive CSP in report-only mode, with `/api/csp-report` (capped, logs host and path only). See section 6 for the enforcement rollout. |
| P3-3 | P3 | The instructor assignment analytics page loaded recharts in its first bundle: 258 kB. | Charts load on demand: 156 kB (−102 kB). |
| P3-4 | P3 | The deep health check always logged "deadline exceeded" 10 s later, even on success, because the timer was never cleared. | Timer cleared. |
| P3-5 | P3 | Optional integrations degraded silently. | A startup `configReport` log line with names and impact only, never values. |
| P3-6 | P3 | Moderate advisories: `next` (SVG image-optimiser bypass; the app doesn't enable SVG optimisation) and `quill` (XSS; stored rich text is sanitised server-side, and the only "fix" is a downgrade). | Documented. Upgrade `next` to 15.5.29 or later in a dependency PR; it wasn't done here because the worktree shares `node_modules` with the dev folder. |

**Verified and found adequate (no change):**
- **Sessions:** HttpOnly cookie sessions with rotation and family revocation; suspended or inactive accounts are refused on every request and lose their sockets. There's no OAuth.
- **Routes:** 197 API routes. 182 require a session; the 15 public ones are health, auth entry points, retired routes that return 410, the socket, the signed webhooks and the CSP report.
- **CSRF:** Origin plus a custom header on every state-changing request. CORS echoes only the exact trusted origin.
- **Secrets:** a full git-history scan found only three placeholder lines in a markdown guide. No secret values appear in the 133 client bundles (only variable names as UI labels).
- **Startup:** refuses to start without the database URI, the JWT secret or `APP_ORIGIN`. Outside production, a non-production database name is required.
- **Existing hardening:** uploads elsewhere already validate type, size and signature and use random names. The audit log is append-only by contract and role.

## 3. Database (explain plans, local MongoDB 9.0.4)

`scripts/query-profile.js` was run at 60,000 notifications, 400 practical tasks and 3,000 community news items.

| Query | Before (docs examined) | After | Index |
|---|---|---|---|
| Email queue (worker, every 30 s) | 9,601, collection scan | 25 | C1 `{channels.email.state, channels.email.nextAttemptAt}` |
| Webhook lookup by provider id | 31,338, collection scan | 1 | C2 `{channels.email.providerId}` sparse |
| A student's practical tasks | 400, collection scan + sort | 42 | C3 `{recipients, publishedAt}` partial `schema: practical_v2` |
| Announcements visible to a member | 3,000, collection scan + sort | 21 | C4 `{kind, status, publishedAt}` partial `kind: announcement` |
| Notification list and unread count | 21 and 30 (existing L4) | unchanged | none needed |

- **Index sizes at that volume:** C1 about 330 KB, C2 about 700 KB, C3 about 1.4 MB (multikey; grows with recipients), C4 under 30 KB. Write overhead is one index entry per notification for C1 and C2.
- **Script:** `scripts/communication-indexes.js` does a dry run by default and builds with `--apply`. It's idempotent and was tested locally. **Not built in production; your approval is needed.**
- **Integrity:**
  - payment idempotency, enrollment uniqueness and progress were verified by the real-MongoDB suites;
  - trading orders can't be processed twice, ledger retries don't duplicate, and recovery and sweep are covered, including a hard-kill test (30 of 30);
  - ledger reconciliation also runs in the restore drill.

## 4. Backup and disaster recovery

The drill is `scripts/restore-drill.js`. It runs only against localhost or an explicitly named test host, and CI runs it on every change. On MongoDB 9.0.4, 13 of 13 checks passed:
- every application index was created on the source;
- 34 collections and 299 documents were backed up in about 0.3 s;
- the four safety refusals worked (production name, unsuffixed name, non-empty target, tampered file);
- the restore completed in about 3.3 s;
- collections, counts and index definitions were identical to the source;
- trading ledgers reconcile on the restored copy;
- BSON types were preserved (Decimal128, ObjectId, Date, Long, integer kobo);
- admin finance totals were identical (₦187,650.00 over 15 payments in both);
- notification delivery figures were identical;
- the source database was untouched.

**Not demonstrated, and why:**
- **Production restore:** no restore from the production Atlas cluster was performed. There's no backup access from this environment, and restoring production data needs your approval.
- **Atlas backups unknown:** whether the Atlas tier has automated backups or point-in-time recovery is unknown (the free M0 tier has neither).

**Proposed RPO and RTO**, pending your confirmation of the Atlas tier:
- **RPO:** 24 h with a daily `scripts/db-backup.js` run, or the Atlas snapshot interval.
- **RTO:** under 1 h. At current data volume the restore takes seconds; most of the time goes on repointing `MONGODB_DB_NAME` or the connection string and verifying.

**DR procedure:**
1. Back up with a read-only database user.
2. `scripts/db-restore.js --verify-only` to check the backup.
3. Restore to `<name>_restore`.
4. Run the smoke tests (section 7) against it.
5. Repoint the application.
6. Never restore over the live database.

## 5. Monitoring and logging

**What exists:**
- structured JSON logs for payments, the trading sweep, the communication worker, webhooks and CSP;
- a request id on every unexpected error, both logged and returned to the client;
- `/api/health` (shallow, for Render's health check) and `?deep=1` (database ping);
- the `/admin/communication` page (email queue, failures, socket counters, worker);
- the admin reconciliation page;
- the startup configuration report.

**Not operational, and needs a choice from you:** no external error tracker or alerting is connected. The logs are on Render.

**Suggested Render log alerts:** `"result":"failed"`, `mongoConnect`, `emailDelivery`, `tradingEvaluator` and `cspViolation`, plus 5xx rates. Render's free tier has limited log retention.

## 6. CSP rollout (report-only now)

1. Deploy as is. Browsers report would-be violations; nothing is blocked.
2. After a week of normal use, review the `cspViolation` lines on Render. Add any expected host, such as the PropellerAds script hosts configured in `NEXT_PUBLIC_PROPELLERADS_*`.
3. Move the value from `Content-Security-Policy-Report-Only` into `Content-Security-Policy` in `next.config.js`.
4. Browser-test checkout, consultation video, lesson video and ads.

## 7. Release and rollback runbook

**Pre-deployment checks:**
- CI is green: tsc, lint, unit tests, audit, build, MongoDB suites and the restore drill.
- Review the diff for migrations or index changes.
- Confirm the environment variable list with the startup configReport.

**Database changes:**
- Index scripts run as a dry run first, then `--apply` with approval, before the code that needs them.
- No phase so far needed a destructive migration.
- A rollback of application code does not undo database changes. Every index script has `--rollback`, which drops only its own indexes.

**Deployment sequence:** merge to master, then Render builds (`npm install && npm run build`) and starts `npm start`. It switches traffic once `/api/health` answers 200.

**Health verification:**
- `/api/health` and `/api/health?deep=1` answer 200;
- signed-out checks: `/api/courses` is 200, and protected routes such as `/api/practical-tasks` and `/api/communication/preferences` are 401;
- `/robots.txt` lists the Disallow rules;
- a private page carries `X-Robots-Tag`.

**Post-deploy smoke tests** (signed in, test accounts):
1. Log in.
2. Open the dashboard.
3. Open a lesson.
4. Place and close a practice order.
5. Read notifications.
6. As admin, open the communication operations and reconciliation pages.

**Failure signals:** 5xx on health; `mongoConnect` or `tradingEvaluator` failures; error spikes in Render logs; checkout failures.

**Rollback decision:**
- Roll back for a P0 or P1 regression (sign-in, payments, trading ledger or data exposure) that can't be fixed forward within 30 minutes.
- In Render, use "Rollback" to the previous deploy. In git, revert the release commit on master.
- Then re-run the health checks and smoke tests, check reconciliation for payments made during the incident, and confirm the trading sweep log is healthy.

**Recommended (not changed, because they alter production deploys):**
- Render `buildCommand: npm ci && npm run build`, so builds use the lockfile.
- Pin Node with `"engines": { "node": "22.x" }`.

## 8. Testing evidence

| Suite | Result |
|---|---|
| Unit and route suite (`npm test`) | 1,264 of 1,264, including 11 new Phase 15 tests |
| Real-MongoDB suites, local 9.0.4 replica set | 143 of 143 across 10 suites (payments, enrollment, progress, assessments, trading, market, hard-kill, sweep, index conflicts, rate limit) |
| Restore drill | 13 of 13 |
| TypeScript | clean |
| Lint (`npm run lint`, whole repository) | 0 errors |
| Production build | passes |
| Production-mode HTTP smoke test (built app, local database) | headers, robots and sitemap, deep health, the webhook and CSP exemptions, and CSRF refusal of other posts all behave as intended |

**Browser verification:** headless Edge layout checks only, done in earlier phases. No signed-in journeys were run in a real browser or against production.

**Critical journeys:** covered by route-level tests (authentication, courses and lessons, assessments, practical tasks, trading, payments with duplicate webhooks, communication). Not exercised end to end in a browser.

## 9. Accessibility, SEO, compatibility

- **Accessibility:** semantic landmarks, labelled controls, keyboard-reachable dialogs and status regions are used across the recent phases. No automated axe audit or screen-reader pass was run.
- **SEO:** page titles and descriptions now have defaults (two public pages set their own), robots and sitemap exist, and private areas are noindex.
- **Browser compatibility:** modern evergreen browsers. Push needs the Push API, and falls back to in-app and email.

## 10. Files

**Changed:**
- **Connection and health:** `db/mongoClient.ts`, `lib/mongodb.js`, `lib/mongodb.ts`, `lib/check-mongo.ts`.
- **Guards and limits:** `lib/content-rate-limit.js` and `.d.ts`, `lib/request-guard.js`.
- **Config and app shell:** `next.config.js`, `package.json`, `pages/_app.tsx`, `server.js`.
- **Chat and uploads:** the two chat upload routes, the three chat message routes, `pages/api/upload/profile.ts`, `pages/api/certificates/upload.ts`.
- **Performance:** `pages/instructor/assignments/analytics/[assignmentId].tsx`.
- **Retired scripts:** `scripts/backup-data.js`, `scripts/restore-data.js` (now refuse to run).
- **Tests:** `tests/browser-hardening.test.js`, plus two integration test files.

**New:**
- **CI:** `.github/workflows/ci.yml`.
- **Library:** `lib/chat-attachments.ts`, `lib/communication-indexes.js`, `lib/config-report.js`, `lib/db-backup.js`, `lib/mongo-options.js` and `.d.ts`, `lib/seo.js`.
- **Routes and components:** `pages/api/attachments/[kind]/[id].ts`, `pages/api/csp-report.ts`, `pages/api/seo/[file].ts`, `components/instructor/AssignmentAnalyticsCharts.tsx`.
- **Scripts:** `communication-indexes.js`, `db-backup.js`, `db-restore.js`, `query-profile.js`, `restore-drill.js`.
- **Tests and docs:** `tests/phase-15-readiness.test.js`, this report.

**Database:** no production change. Message documents gain an optional `attachment` field for new chat files.

## 11. Remaining dependencies and risks (your action)

1. **Atlas backups:** confirm the tier, enable snapshots or point-in-time recovery, or schedule `scripts/db-backup.js` daily with a read-only user and off-site storage. Then run one restore drill from a real backup into `<name>_restore`.
2. **Indexes C1–C4:** approve `scripts/communication-indexes.js --apply` against production.
3. **Resend:** production domain verification is deferred until a custom domain exists. Then set `RESEND_WEBHOOK_SECRET` and the webhook URL. Email was verified locally only: queue and template unit tests, provider idempotency keys and signature checks. There's no confirmed delivery.
4. **Push:** VAPID keys are not set. Push stays off, and in-app and email carry everything.
5. **Error tracking and alerts:** choose a service (or Render log alerts) and set thresholds.
6. **CSP:** collect reports, then enforce (section 6).
7. **Dependency PR:** upgrade `next` to 15.5.29 or later.
8. **Render:** switch to `npm ci` and pin Node 22.
9. **Browser journeys:** run a signed-in pass on staging or production with test accounts (smoke list in section 7).
10. **Chat attachment storage:** needs Cloudinary configured in production. Without it, file sharing answers 503 and text chat still works.

**Remaining findings:**
- **P0 / P1:** none known after these fixes.
- **P2:** items 1, 2 and 5 above.
- **P3:** items 6, 7 and 8.
