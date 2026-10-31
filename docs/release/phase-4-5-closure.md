# Phase 4.5 closure: HttpOnly cookie sessions

**Status: CLOSED. Implementation accepted, committed locally; production activation pending owner approval.**

| Item | Value |
|---|---|
| Worktree | `C:\Users\Juliet\Downloads\forexorbit_academy-phase-4-5-secure-sessions` |
| Branch | `feat/phase-4-5-secure-sessions` (local only, no upstream) |
| Commit | `7dca2c8`, parent `f3e728a` (unchanged since acceptance) |
| Design | `docs/phase-4-5/architecture.md`, `session-lifecycle.md`, `hosting-architecture.md` |

## Delivered

- Opaque sessions in an HttpOnly cookie, `__Host-fo_session`: Secure, SameSite=Lax, host-only. Only the SHA-256 of the session id is stored.
- Session timing:
  - 30-minute idle expiry and a 12-hour absolute lifetime;
  - rotation every 15 minutes, with a 30-second grace period for parallel tabs;
  - presenting an old id after rotation ends that whole sign-in.
- Revocation:
  - server-side logout and logout-everywhere;
  - revocation on password change or reset, suspension, role change and account deletion.
- Request protection:
  - every state-changing request needs the exact Origin plus a CSRF header;
  - CORS answers only the exact origin;
  - wildcard platform origins were removed;
  - production refuses to start without an https `APP_ORIGIN`.
- WebSockets authenticate with the same cookie, check the Origin, and re-check the session on activity and every 30 seconds.
- No credential is readable by browser scripts.
- A temporary, off-by-default legacy-token exchange, which closes by 31 January 2027 at the latest.
- The session index script and the database-role definition.
- Permissions are unchanged, including the rule that only the Super Admin approves registrations.

## Validation

**On the committed tree:**

- 746/746 tests, tsc 0 errors, ESLint 0 errors, build passes.
- Acceptance on cookies: 77/77.
- Session end-to-end checks: 36/36 (real server, Socket.IO client, two Edge tabs).
- Acceptance guard: 4/4.
- Production-mode check: the run-time `APP_ORIGIN` is enforced by the middleware.
- Secrets and whitespace checks are clean.
- Mutation checks confirm the core security tests actually catch failures.

**Combined with the learning-level fix** (`d14a756`), checked in a throwaway tree: 754/754 tests, tsc, build, acceptance 77/77.

## Not yet validated

This is staging work: see `staging-validation-checklist.md`.

- Firefox, Safari and iOS Safari.
- Real HTTPS on the Render origin.
- The legacy exchange while it is switched on, in a running server.
- Atlas behaviour for the new collection, role and TTL index.
