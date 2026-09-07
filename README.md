# Properly (EstateFlow)

UK landlord and property-portfolio SaaS: a Vite + React single-page app in `src/`
backed by Supabase (Postgres with row-level security, Edge Functions in
`supabase-functions/`, migrations in `supabase-migrations/`), hosted on Vercel at
https://www.ownproperly.com. The npm package name is `ownproperly`.

This is customer-facing production software handling real financial, tenancy and
compliance data. Read `CLAUDE.md` before changing anything: it records the
governance rules (no direct pushes to `main`, migrations are production changes,
never weaken RLS) and links the runbooks.

## Working on it

```bash
npm ci
npm run dev        # needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local
npm run lint       # eslint; CI runs this
npm test           # vitest; 600+ tests, the money maths lives in src/lib
npm run build      # what Vercel runs to deploy
```

All three of lint, test and build must pass before a branch is pushed; CI runs the
same three on every pull request.

## Where things live

- `src/App.jsx` routing shell, `src/components/` pages and panels, `src/lib/` pure
  logic with tests in `src/lib/__tests__/`, `src/lib/api/` the Supabase calls.
- `supabase-functions/<name>/index.ts` is the source of record for every deployed
  Edge Function. If a function exists in production it must exist here.
- `supabase-migrations/` SQL applied to production through the Supabase MCP
  `apply_migration` call; see `DEPLOYMENT_RUNBOOK.md` for the procedure and the
  parity check.

## Runbooks

- `DEPLOYMENT_RUNBOOK.md` deploys, migrations, function deploys
- `SECURITY_AND_QUALITY_AUDIT.md` the June 2026 deep audit and its remediation
- `NIGHTLY_AUDIT.md` what the 05:15 UTC production audit checks and how to read it
- `LAUNCH_CHECKLIST.md`, `OVERNIGHT_AUDIT.md`, `MARKETING_STRATEGY.md`, `EMAIL_SEQUENCES.md`
