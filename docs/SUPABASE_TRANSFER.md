# Flow+ Supabase Project Transfer Runbook

Target organization: `aicompany`

This is a manual production runbook. Do not transfer the project, disconnect GitHub,
change secrets, or run destructive SQL as part of normal application deployment. Flow+
and AI Company remain separate Supabase projects and databases.

## Preconditions and stop conditions

- Schedule a maintenance window and name an operator plus rollback owner.
- Confirm access to the current and target organizations and the production project.
- Confirm the target organization can accept the project's region, plan, add-ons, and spend.
- Stop if a downloadable/logical backup cannot be verified, if Auth/Edge Function secrets
  cannot be inventoried, or if the target organization is wrong.
- Supabase currently blocks this transfer while the project is connected to GitHub. Do not
  disconnect it until the backups and inventory below are complete.

## 1. Backup and inventory (before any disconnect)

1. Create a production database backup and record its timestamp and retention location.
2. Produce a schema-only dump and a data/role-aware logical dump using the current
   Supabase-supported CLI/dashboard workflow. Verify the files are non-empty and restorable
   in a disposable environment when possible.
3. Explicitly verify the known baseline-debt tables are present in the dump:
   `transactions`, `scheduled_payments`, `account_balance`, and `stock_holdings`.
   Do not add replacement `create table` migrations merely to make the repository look complete.
4. Export/inventory Auth configuration: providers, redirect URLs, email/SMTP settings,
   JWT/session settings, hooks, and a user-count snapshot. Do not export user passwords.
5. Inventory Edge Functions, deployed versions, schedules, and function secrets. Record secret
   names only in this document/checklist; keep values in the approved secret manager.
6. Inventory Storage buckets/policies, Database extensions, Webhooks, Realtime settings,
   network restrictions, custom domains, and any connection pool configuration.
7. Inventory Vercel variables for Production/Preview/Development:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY`. Also inventory the server-only notification variables
   `AI_COMPANY_FLOW_EVENT_URL` and `FLOW_EVENT_SECRET`. Do not paste their values into tickets
   or commits.
8. Verify current flows before transfer: sign-in, budget/dashboard reads, GAS transaction import,
   investment-capacity integration, finance-summary integration, and card-activity integration.

## 2. Disconnect GitHub and transfer

1. Pause application releases and database migrations.
2. In Supabase Dashboard, disconnect the project's GitHub integration. Record repository,
   branch, directory, and integration settings so they can be restored exactly.
3. Reconfirm the destination organization shown by Supabase is exactly `aicompany`.
4. Review plan/billing changes shown by Supabase. A human owner must approve any paid change.
5. Use the Supabase Dashboard project transfer action. Transfer the existing Flow+ project;
   do not create a replacement project and do not copy Flow+ tables into AI Company's database.
6. Wait for Supabase to report the transfer complete. Do not rotate keys unless Supabase requires
   it or the security owner has separately approved a rotation plan.

## 3. Post-transfer verification

1. Confirm project health, region, database status, backups, extensions, Storage, Realtime, and
   Edge Functions in the `aicompany` organization.
2. Confirm Auth configuration and perform a real sign-in/sign-out/session refresh smoke test.
3. Run read-only row-ownership checks for representative users. Confirm RLS remains enabled and
   cross-user reads/writes are rejected; the transfer must not alter policies.
4. Verify GAS import with a controlled unique test transaction, then confirm duplicate import is
   idempotent. Remove the test entry through the normal product workflow if appropriate.
5. Verify Integration Tokens: missing/invalid token returns 401; wrong scope returns 403;
   AI Company can read finance summary/card activity and cannot write transactions; GAS can
   import and cannot read finance APIs.
6. Verify all Vercel environments still reference the correct project URL and keys. If values
   changed, update them through Vercel's secret controls and redeploy only with human approval.
7. Reconnect the GitHub integration using the recorded repository/branch settings. Confirm the
   connection no longer blocks project operation and does not run an unexpected migration.
8. Re-run Flow+ typecheck, tests, build, a browser smoke test, and production health checks.
9. Record transfer timestamp, operators, project reference, backup identifiers, verification
   evidence, and any follow-up actions in the operations log.

## Rollback / incident response

If transfer or verification fails, stop writes/releases, preserve logs, and contact Supabase
support before attempting a second transfer. Restore from the verified backup only under an
approved incident plan. Never merge the Flow+ database into the AI Company database as a
workaround. Treat exposed or accidentally logged keys as compromised and rotate them through
the approved secret-management process.

## Card-activity scope migration (separate manual change)

This repository includes `supabase/migrations/20260930003257_add_card_activity_scope.sql`.
It only replaces the existing token-issuance function so newly issued AI Company tokens receive
`card-activity:read`; it creates no tables and changes no RLS policy. It has not been applied by
this implementation work.

Manual application, after review and backup:

```bash
supabase link --project-ref <FLOW_PROJECT_REF>
supabase migration list --linked
supabase db push --dry-run --linked
supabase db push --linked
```

Then issue a new AI Company token, verify read-only scopes, switch the consumer, and revoke the
old token. Do not add the scope to GAS. For rollback, execute
`docs/sql/rollback_card_activity_scope.sql` through the approved SQL workflow, verify existing
AI Company token rows no longer contain `card-activity:read`, and disable the consumer endpoint.
