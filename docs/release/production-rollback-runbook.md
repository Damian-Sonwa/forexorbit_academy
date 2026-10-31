# Production rollback runbook

Rollback restores the **previous application code**. The data needs nothing: the release changes no existing documents. It only adds the `sessions` collection, its indexes and one role privilege, and the old code ignores all three.

## Decide

Roll back on a stop condition:

- sign-in fails broadly and is not a quick configuration fix (missing `APP_ORIGIN`, a role grant);
- sockets cannot connect;
- payments or webhooks fail because of the release;
- any sign that a session works from an origin other than `APP_ORIGIN`.

## Safe actions (operator; no data decision needed)

1. **Render: redeploy the last good deploy.**
   - Render Dashboard → the service → Events/Deploys → the deploy before the release → **Rollback**. That is the commit `d7e0d1d`, or the stage-2 redirect commit.
   - Render serves the previous build without rebuilding.
   - Note: Render auto-deploys `master`. If the release commit stays on `master`, the next push redeploys it. Either revert on `master` (a new revert commit, approved) or pause auto-deploy until the fix.
2. **Configuration:**
   - Leave `APP_ORIGIN` and `AUTH_LEGACY_BEARER_UNTIL` in place; the old code ignores them.
   - Keep `JWT_SECRET` unchanged; the old code needs it.
   - Keep `APP_BASE_URL` on the Render origin if users stay on Render.
3. **Users:**
   - People with a session cookie are signed out once: the old code reads `localStorage`, which the new code cleared.
   - The leftover `__Host-fo_session` cookie is ignored by the old code and expires within 12 hours.
   - Old 7-day tokens from before the release work again if they have not expired and their account's session generation was not raised during the release.
   - Sessions ended by sign-out-everywhere, password change or reset, suspension or role change stay ended.
4. **Paystack:** the old code accepts the same webhook path on Render. Leave the webhook URL on Render.
5. **Vercel:**
   - **Render rollback only:** keep the Vercel redirect. The old Render build works on its own (it is same-origin), so users stay on Render.
   - **Restoring the Vercel address as the entry point** (only if Render itself is unusable): remove the `redirects` entry from `vercel.json` with an approved commit, or promote the last pre-redirect Vercel deployment in Vercel → Deployments → **Promote to Production**.
     - That old Vercel frontend calls the Render API, so it only works while Render runs the **pre-4.5** code.
     - The redirect was set up as a 307 (not cached), so browsers follow the change at once.
     - To remove it with Git: `git revert 3a97fd5` on `master` (a new commit; approved; Render redeploys the same code).

## Actions that need an owner or database decision

| Action | When | Notes |
|---|---|---|
| Remove the `sessions` privilege from `forexorbitAppRole` | after a long rollback | harmless to leave |
| Drop the session indexes or the `sessions` collection | **never automatically** | It holds only hashes, and rows delete themselves about 36 hours after sign-in. Dropping loses the audit trail of revocations and reuse detection. |
| Revert commits on `master` | to stop auto-deploy from redeploying the release | a new revert commit, approved and pushed |
| Change Paystack webhook URL | only if the entry host changes | |

## Incident response

1. Note the time and the symptom. Collect Render logs for the window; they contain no cookies or tokens by design.
2. If session theft is suspected:
   - "sign out everywhere" for the affected account, or raise its `sessionGeneration` (a Super Admin action or a database decision);
   - check `passwordResetSecurityLogs` for `session_reuse_detected`.
3. After a rollback, re-run the stage-7 checks from `production-deployment-runbook.md` against the old build, and record the outcome.
