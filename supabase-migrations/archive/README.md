# Archived migrations: do not run

These are the undated SQL files from before the dated
`YYYY-MM-DD_<topic>.sql` convention:

- `row-level-security.sql`
- `feature-flags.sql`
- `user-roles.sql`
- `audit-and-soft-delete.sql`
- `backup-system.sql`
- `compliance-reminders.sql`
- `dashboard-widgets.sql`
- `historic-data-import.sql`
- `property-documents-ocr.sql`

They are kept for history only. Later dated migrations in `supabase-migrations/`
have replaced them. The policies, functions and grants in these files are
older and often weaker than what runs in production. For example,
`row-level-security.sql` recreates membership-only write policies that the
2026-06-10 and 2026-10-14 security migrations replaced.

**Never re-run any file in this folder** against production
(`hqrhqbkqxzllmzhcofrh`) or any other database. Re-running one would quietly
roll security fixes back. To see what is live, query the live database
(`pg_policies`, `pg_proc`, `information_schema`) as `DEPLOYMENT_RUNBOOK.md`
describes.

They were moved here on 14 Oct 2026. Older dated migrations and audit docs
still cite them by bare filename (e.g. "row-level-security.sql:222"). Those
references point at the files in this folder.
