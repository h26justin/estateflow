-- Statement label aliases — teach the importer an agent's spelling of a property.
--
-- Managing agents hand-key property labels onto their statements, so the same
-- unit arrives as "35 Henley Road" one month and "Henly Road" the next. The
-- importer's fuzzy matcher copes with most of that, but when it doesn't the
-- user fixes the match by hand in the preview step — and then has to fix it
-- again next month. This table records those corrections so a label only ever
-- needs fixing once.
--
-- Lookup is on `alias_norm` (lowercase, punctuation stripped, whitespace
-- collapsed, street-type abbreviations folded — see normaliseStatementName in
-- src/lib/statementParser.js). Keep the two in step: the client computes the
-- normalised form, so a change there wants a backfill here.

create table if not exists public.property_statement_aliases (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  alias       text not null,
  alias_norm  text not null,
  source      text not null default 'learned' check (source in ('learned','manual')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One meaning per label per user. Re-teaching a label repoints it (upsert)
-- rather than leaving two rows racing to win the lookup.
create unique index if not exists property_statement_aliases_user_norm_idx
  on public.property_statement_aliases (user_id, alias_norm);

create index if not exists property_statement_aliases_property_idx
  on public.property_statement_aliases (property_id);

alter table public.property_statement_aliases enable row level security;

-- Supabase's default privileges grant `anon` full DML on every new public
-- table. RLS already returns nothing for an anonymous caller (auth.uid() is
-- null in every policy below), but nothing here is public, so close the door
-- at the grant level too rather than leaning on RLS alone.
revoke all on public.property_statement_aliases from anon;

-- Same access shape as property_notes: your own rows, plus anything on a
-- property you have access to, so aliases learned by one colleague apply to
-- the whole team's imports.
drop policy if exists property_statement_aliases_select on public.property_statement_aliases;
create policy property_statement_aliases_select on public.property_statement_aliases
  for select using (
    is_developer()
    or user_id = (select auth.uid())
    or has_property_access(property_id)
  );

drop policy if exists property_statement_aliases_insert on public.property_statement_aliases;
create policy property_statement_aliases_insert on public.property_statement_aliases
  for insert with check (
    user_id = (select auth.uid())
    and (has_property_access(property_id) or is_developer())
  );

drop policy if exists property_statement_aliases_update on public.property_statement_aliases;
create policy property_statement_aliases_update on public.property_statement_aliases
  for update using (
    is_developer()
    or user_id = (select auth.uid())
    or has_property_access(property_id)
  );

drop policy if exists property_statement_aliases_delete on public.property_statement_aliases;
create policy property_statement_aliases_delete on public.property_statement_aliases
  for delete using (
    is_developer()
    or user_id = (select auth.uid())
    or has_property_access(property_id)
  );
