# Rollback plan

> **Superseded for the release** by `docs/release/production-rollback-runbook.md`.

## Code

Redeploy the previous release (`f3e728a`, or whatever production ran before). Nothing in Phase 4.5 changes existing documents, so the old code runs unchanged against the same database.

What users see after a rollback:

- Everyone signed in with a cookie session is signed out once. The old code reads `localStorage.token`, which the new code deleted.
- The `__Host-fo_session` cookie stays in browsers until it expires (12 hours at most). The old code ignores it.
- Old tokens issued before the release work again if they are within their 7 days and their generation is unchanged. Sessions ended during Phase 4.5 by a generation increase stay ended (sign out everywhere, password change or reset, suspension, role change). Ones ended only by a plain sign-out do not (the old design had no per-session revocation).

## Database

Nothing has to be undone for the old code to work. Optional clean-up, privileged account, after a decision:

- `db.sessions.drop()` removes the collection and its indexes. The rows contain no reusable secret (hashes only), so leaving them until the TTL index removes them (about 36 hours after each sign-in) is also fine.
- Remove the `sessions` privilege from `forexorbitAppRole`.

Role changes made during Phase 4.5 raised `sessionGeneration` once more than before. That only means those people sign in again; nothing to undo.

## Configuration

- `APP_ORIGIN` and `AUTH_LEGACY_BEARER_UNTIL` are ignored by the old code; they may stay.
- If `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SOCKET_URL` or `ALLOWED_ORIGINS` were removed for Phase 4.5 and the old layout needs them, restore them before rebuilding the old version.

## Partial rollback

Not supported. Running the cookie code with bearer support, or the bearer code with cookie support, would reopen the risks Phase 4.5 removes. The legacy upgrade route is the only bridge, and it only converts bearer tokens into cookie sessions.
