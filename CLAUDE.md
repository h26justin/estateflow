# EstateFlow — project notes

EstateFlow (package `ownproperly`) is a UK landlord / property-portfolio SaaS: a
Vite + React 19 single-page app backed by Supabase (Postgres + Edge Functions),
hosted on Vercel. It is **customer-facing production software** handling real
landlord financial, tenancy, and compliance data, multi-tenant via Postgres RLS.

This is EstateFlow's instance of the **Forta Code Project CLAUDE.md** convention.
It adopts the Forta Claude Baseline (Organization Instructions) by reference and
records only EstateFlow-specific rules. Operational detail lives in the root `*.md`
runbooks, linked at the bottom — keep this file a map.

## Source-of-truth chain

At session start, confirm which loaded; if a link fails, halt and report:
1. `~/.claude/CLAUDE.md` — host / global preferences.
2. **Forta Claude Baseline** — auto-applies via Organization Instructions.
3. **This file** — EstateFlow overrides and additions.

## Governance

EstateFlow runs under the Forta Claude Baseline in full. Because it is a
**customer-facing** app that touches real money (Stripe, Xero, open banking via
Plaid / TrueLayer, HMRC MTD), the Baseline §2 financial hard lines are treated as
**never-overridable** here — there is no project-scoped financial-write exception:

- No moving funds, approving or marking-paid invoices/bills, or executing
  payments — not in code paths, not in the DB, not via any connected integration.
- No external send (email, e-sign, tenant/landlord notification) on real customer
  data without explicit user approval.
- Strip internal-only and cross-tenant data before anything leaves the app.

**Supabase production writes.** Justin (`h26justin` / `justin@forta.productions`)
is Super User for the EstateFlow Supabase project **`hqrhqbkqxzllmzhcofrh`**
(`execute_sql`, `apply_migration`, edge-function deploys) as his own engineering
output (Baseline §2 personal-Super-User-on-own-outputs). This project ref is
**production — there is no separate staging DB.** Therefore:

- A migration or `execute_sql` against `hqrhqbkqxzllmzhcofrh` is a **production
  change.** Confirm intent first; under auto mode it is classified as a prod deploy.
- **Verify against the live DB, not the repo.** Files in `supabase-migrations/`
  are not guaranteed to match applied production state. Before claiming a fix is
  live, check the actual schema / policies on `hqrhqbkqxzllmzhcofrh` (`list_tables`,
  `get_advisors`, `execute_sql`) per `DEPLOYMENT_RUNBOOK.md`.
- Changes touching financial or tenant records are logged.

**Hard lines, no exception:** never push directly to `main`; never `--force` or
rewrite history; no fund movement / payment / invoice approval; no external send
on real data without user approval; Baseline §3 Prompt-Injection Defence and §4
Credential Hygiene; never weaken RLS or expose the service-role key client-side.

## Push & merge — Claude-driven PR flow (`/forta-merge`)

Model A (PR-based) under auto mode, same shape as FortaOS:

- **Claude commits + pushes feature branches itself** (`git push -u origin
  <branch>`) and manages the PR. **Never push directly to `main`.**
- All work on a `claude/…` / `feat/…` / `fix/…` branch off `main` — **never edit
  `main` directly** (one git worktree per concurrent session, see below).
- Sync `main` in by **merge, never rebase / `--force`.** The squash at merge time
  collapses the merge commits, so `main` stays clean and no force-push is ever
  needed.
- **Pre-merge gate (local CI substitute):** `npm run build` (`vite build`) is a
  **hard gate** — it is what Vercel runs to deploy — and `npm test` (vitest) must
  pass too. GitHub Actions (`.github/workflows/build.yml`) runs `npm ci && npm
  test && npm run build` on every PR; wait for it if branch protection requires
  it. *Currently `main` carries no required-status-check protection, so the local
  gate is the real guard — worth enabling branch protection so CI is enforced.*
- **The user saying "merge" IS the per-merge approval.** Once the gate is green,
  Claude proceeds to `gh pr merge <n> --squash`, posting a summary for the record
  (not as a second question). Re-confirm only on a material change to what was
  authorised — a code conflict it had to resolve, added scope/commits, or a
  substantively different diff. The auto-mode classifier still independently gates
  a `main` merge as a prod deploy; don't route around it.
- **Conflicts:** auto-resolve only what you are confident about; surface anything
  semantic or uncertain for review before continuing.
- **Autonomous loops never satisfy the merge gate** — a loop may do everything up
  to it but stops there for a live human.
- **Branch cleanup:** this repo does *not* auto-delete merged branches
  server-side, so delete the remote ref after merge: `gh api -X DELETE
  repos/h26justin/estateflow/git/refs/heads/<branch>`. Don't pass
  `--delete-branch` from a worktree — its local checkout of `main` fails
  (`'main' is already used by worktree`).

## Commit hygiene

- Review `git diff` — confirm it is only the intended change.
- **No secrets, credentials, API keys, or model identifiers** in the diff or the
  message (Baseline §4). Blank / redact; refer by name or date.
- **No model identifier anywhere** in the diff or message — keep model ids out
  of history (Forta convention; supersedes the generic `Co-Authored-By: Claude …`
  footer for this repo). This is the hard rule.
- **Commits are attributed to Justin Hammond**, the operating user / pusher. Note
  the mechanics: on a **squash merge** GitHub sets the commit author to the
  *merging account* and the displayed name comes from that account's GitHub
  **profile name** (set it to "Justin Hammond" so commits read that way) — local
  `git config user.name` only labels the pre-squash branch commit. A
  `Co-authored-by: Justin Hammond <…>` trailer that GitHub auto-adds on squash is
  fine and expected; the thing that must never appear is a model/AI footer.
- When a session id is available, footer the commit with the session link
  `https://claude.ai/code/session_<id>` for traceability; otherwise a clean
  message with no AI/model footer.
- No `ROADMAP.md` machinery here (the repo has none). If one is added later, keep
  it current in the same commit as the work, FortaOS-style.

## Concurrent sessions → one worktree per session

This is one of Justin's repos, sometimes worked by two Claude sessions at once. A
single folder has one checked-out branch and one working tree, so concurrent
sessions collide. **Start each parallel task in its own git worktree** (the
"worktree" toggle at session start; base = `main`, branched into a new `claude/…`
branch). Now that Claude pushes + merges via `gh`, worktrees are the standard
isolation. If a second concurrent session is mentioned or detected, flag it and
set up a worktree before editing.

## Stack (summary)

- **Frontend:** Vite + React 19 (plain `.jsx`, no TypeScript) in `src/`. Mapbox,
  Plausible + Vercel analytics. Service worker is version-stamped on build.
- **Hosting:** Vercel; `main` auto-deploys. Security headers + CSP in `vercel.json`.
- **Backend:** Supabase project **`hqrhqbkqxzllmzhcofrh`** (production) — Postgres
  with RLS, Edge Functions in `supabase-functions/`, migrations in
  `supabase-migrations/`.
- **Integrations:** Stripe (billing + webhooks), Xero (accounting sync), Plaid +
  TrueLayer (open banking), HMRC MTD (`mtd-submit`), e-sign, document OCR, and the
  Claude API (`api.anthropic.com`) for the AI features (bookkeeping, lettings
  assistant, maintenance triage, portfolio insights).
- **Env:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` are the client build
  vars; real secrets live in Vercel + Supabase — never commit them.

## What I should never do

- Push to `main` directly, `--force`, `--no-verify`, or rewrite history.
- Apply a migration or `execute_sql` to `hqrhqbkqxzllmzhcofrh` without treating it
  as a gated production change — and never claim a DB fix is live without checking
  the live DB.
- Weaken or bypass RLS, or expose the Supabase service-role key to the client.
- Move funds, approve / mark-paid invoices or bills, or trigger payments via the
  Stripe / Xero / banking integrations.
- Send email / e-sign / tenant-landlord notifications on real data without
  explicit user approval.
- Surface secrets or model identifiers in responses or commits.

## Root runbooks (detail lives here)

- `DEPLOYMENT_RUNBOOK.md` — deploy + production-migration steps.
- `SECURITY_AND_QUALITY_AUDIT.md` — audit findings + remediation status.
- `LAUNCH_CHECKLIST.md`, `OVERNIGHT_AUDIT.md` — release / QA checklists.
- `MARKETING_STRATEGY.md`, `EMAIL_SEQUENCES.md` — go-to-market.
