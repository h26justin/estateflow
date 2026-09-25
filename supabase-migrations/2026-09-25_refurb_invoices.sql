-- ============================================================================
-- Refurb invoices: import a contractor invoice / credit note once and
-- allocate it across one or many properties' refurb projects
-- (Properly updates brief, part 3, 25 Sep 2026).
--
-- Rules (Justin, 25 Sep 2026):
--   • An invoice recognises and allocates a COST. It is never a payment:
--     nothing here writes a 'payment' line, so Paid on the Refurbs dashboard
--     only moves when a payment is logged (refurb_lines kind 'payment').
--   • Agreed / Paid are unchanged by an invoice; the app shows a separate
--     Invoiced figure from the allocations. An allocation flagged
--     is_variation also writes an 'extra' line (linked by invoice_id), which
--     is what raises Agreed.
--   • The allocations must add up to the invoice's allocation base (gross,
--     or net when VAT is reclaimable). create_refurb_invoice() enforces it
--     and writes the header, allocations and variation extras in ONE
--     transaction. It runs as the caller (security invoker), so every insert
--     is still checked by RLS.
--   • Duplicate protection: supplier + invoice number per company, case and
--     punctuation insensitive, on live rows.
--
-- Additive and backwards compatible: two new tables, one nullable column on
-- refurb_lines, no backfill, no change to existing rows or to the
-- refurb_mirror_property() maths (it only reads payment/credit lines).
-- ============================================================================

-- ── Company write check (owner / admin / editor), mirroring
--    has_property_permission(..., 'write') at company level.
create or replace function public.has_company_write(p_company_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_role text; v_is_admin boolean; v_is_owner boolean;
begin
  if p_company_id is null then return false; end if;
  if is_developer() or is_platform_admin() then return true; end if;
  if exists (select 1 from companies where id = p_company_id and owner_id = auth.uid()) then return true; end if;
  select role, is_admin, is_owner into v_role, v_is_admin, v_is_owner
    from user_company_access
   where company_id = p_company_id and (user_id = auth.uid()::text or email = auth.email())
   limit 1;
  if v_role is null and v_is_admin is null and v_is_owner is null then return false; end if;
  v_role := coalesce(v_role, case when v_is_admin then 'admin' else 'editor' end);
  return v_is_owner = true or v_role in ('owner', 'admin', 'editor');
end;
$$;
revoke all on function public.has_company_write(uuid) from public, anon;
grant execute on function public.has_company_write(uuid) to authenticated;

-- ── Tables ───────────────────────────────────────────────────────────────
create table if not exists public.refurb_invoices (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc_kind           text not null default 'invoice' check (doc_kind in ('invoice', 'credit_note')),
  credits_invoice_id uuid references public.refurb_invoices(id) on delete set null,
  supplier_name      text not null check (char_length(trim(supplier_name)) > 0),
  invoice_number     text,
  invoice_date       date,
  due_date           date,
  description        text,
  net_amount         numeric check (net_amount is null or net_amount >= 0),
  vat_amount         numeric check (vat_amount is null or vat_amount >= 0),
  gross_amount       numeric not null check (gross_amount > 0),
  allocation_basis   text not null default 'gross' check (allocation_basis in ('gross', 'net')),
  approval_status    text not null default 'received' check (approval_status in ('received', 'awaiting_approval', 'approved')),
  document_id        uuid references public.company_documents(id) on delete set null,
  extracted          jsonb,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid,
  constraint refurb_invoices_net_vat_gross check (
    net_amount is null or vat_amount is null or abs(net_amount + vat_amount - gross_amount) <= 0.01
  ),
  constraint refurb_invoices_net_basis check (allocation_basis = 'gross' or net_amount is not null)
);

create table if not exists public.refurb_invoice_allocations (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.refurb_invoices(id) on delete cascade,
  project_id    uuid not null references public.refurb_projects(id) on delete cascade,
  property_id   uuid not null references public.properties(id) on delete cascade,
  amount        numeric not null check (amount >= 0),
  split_method  text not null default 'even' check (split_method in ('even', 'amount', 'percent')),
  split_pct     numeric check (split_pct is null or (split_pct >= 0 and split_pct <= 100)),
  is_variation  boolean not null default false,
  extra_line_id uuid references public.refurb_lines(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Payments (and refunds) logged against an invoice. Nullable: every
-- existing line stays unlinked.
alter table public.refurb_lines
  add column if not exists invoice_id uuid references public.refurb_invoices(id) on delete set null;

create index if not exists idx_refurb_invoices_company on public.refurb_invoices(company_id) where deleted_at is null;
create index if not exists idx_refurb_invoice_alloc_invoice on public.refurb_invoice_allocations(invoice_id);
create index if not exists idx_refurb_invoice_alloc_project on public.refurb_invoice_allocations(project_id);
create index if not exists idx_refurb_invoice_alloc_property on public.refurb_invoice_allocations(property_id);
create index if not exists idx_refurb_lines_invoice on public.refurb_lines(invoice_id) where invoice_id is not null;

-- Same supplier + invoice number twice in one company = duplicate.
create unique index if not exists uq_refurb_invoices_supplier_number
  on public.refurb_invoices (
    company_id,
    regexp_replace(lower(supplier_name), '[^a-z0-9]', '', 'g'),
    regexp_replace(lower(invoice_number), '[^a-z0-9]', '', 'g')
  )
  where deleted_at is null and invoice_number is not null and doc_kind = 'invoice';

drop trigger if exists refurb_invoices_updated_at on public.refurb_invoices;
create trigger refurb_invoices_updated_at before update on public.refurb_invoices
  for each row execute function public.update_updated_at();

-- ── Row-level security ───────────────────────────────────────────────────
alter table public.refurb_invoices enable row level security;
alter table public.refurb_invoice_allocations enable row level security;

drop policy if exists refurb_invoices_select on public.refurb_invoices;
create policy refurb_invoices_select on public.refurb_invoices for select
  using (public.is_developer() or user_id = auth.uid() or public.has_company_access(company_id));

drop policy if exists refurb_invoices_insert on public.refurb_invoices;
create policy refurb_invoices_insert on public.refurb_invoices for insert
  with check (public.has_company_write(company_id) and public.company_is_live(company_id));

drop policy if exists refurb_invoices_update on public.refurb_invoices;
create policy refurb_invoices_update on public.refurb_invoices for update
  using (public.has_company_write(company_id))
  with check (public.has_company_write(company_id) and public.company_is_live(company_id));

drop policy if exists refurb_invoices_delete on public.refurb_invoices;
create policy refurb_invoices_delete on public.refurb_invoices for delete
  using (public.has_company_write(company_id));

-- Allocations: readable with the invoice; written only where the user can
-- write the target property, and the project really belongs to it.
drop policy if exists refurb_invoice_alloc_select on public.refurb_invoice_allocations;
create policy refurb_invoice_alloc_select on public.refurb_invoice_allocations for select
  using (exists (select 1 from public.refurb_invoices i where i.id = invoice_id
                 and (public.is_developer() or i.user_id = auth.uid() or public.has_company_access(i.company_id))));

drop policy if exists refurb_invoice_alloc_insert on public.refurb_invoice_allocations;
create policy refurb_invoice_alloc_insert on public.refurb_invoice_allocations for insert
  with check (
    public.has_property_permission(property_id, 'write')
    and exists (select 1 from public.refurb_projects rp where rp.id = project_id and rp.property_id = refurb_invoice_allocations.property_id)
    and exists (select 1 from public.refurb_invoices i join public.properties p on p.id = refurb_invoice_allocations.property_id
                where i.id = invoice_id and p.company_id = i.company_id)
  );

drop policy if exists refurb_invoice_alloc_delete on public.refurb_invoice_allocations;
create policy refurb_invoice_alloc_delete on public.refurb_invoice_allocations for delete
  using (public.has_property_permission(property_id, 'write'));

revoke all on public.refurb_invoices from anon;
revoke all on public.refurb_invoice_allocations from anon;
grant select, insert, update, delete on public.refurb_invoices to authenticated;
grant select, insert, delete on public.refurb_invoice_allocations to authenticated;

-- ── Atomic create with reconciliation ───────────────────────────────────
-- p_invoice: refurb_invoices columns (no id). p_allocations: array of
-- { project_id, property_id, amount, split_method, split_pct, is_variation }.
-- Refuses unless the allocations add up to the allocation base.
create or replace function public.create_refurb_invoice(p_invoice jsonb, p_allocations jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_base numeric;
  v_sum numeric;
  v_kind text := coalesce(p_invoice->>'doc_kind', 'invoice');
  a jsonb;
  v_line uuid;
  v_alloc uuid;
begin
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Select at least one property to allocate to';
  end if;

  insert into refurb_invoices (company_id, doc_kind, credits_invoice_id, supplier_name, invoice_number, invoice_date,
    due_date, description, net_amount, vat_amount, gross_amount, allocation_basis, approval_status, document_id, extracted, notes)
  values (
    (p_invoice->>'company_id')::uuid, v_kind, nullif(p_invoice->>'credits_invoice_id', '')::uuid,
    trim(p_invoice->>'supplier_name'), nullif(trim(p_invoice->>'invoice_number'), ''),
    nullif(p_invoice->>'invoice_date', '')::date, nullif(p_invoice->>'due_date', '')::date,
    nullif(p_invoice->>'description', ''),
    nullif(p_invoice->>'net_amount', '')::numeric, nullif(p_invoice->>'vat_amount', '')::numeric,
    (p_invoice->>'gross_amount')::numeric, coalesce(p_invoice->>'allocation_basis', 'gross'),
    coalesce(p_invoice->>'approval_status', 'received'),
    nullif(p_invoice->>'document_id', '')::uuid, p_invoice->'extracted', nullif(p_invoice->>'notes', '')
  ) returning id, case when allocation_basis = 'net' then net_amount else gross_amount end into v_id, v_base;

  select coalesce(sum((x->>'amount')::numeric), 0) into v_sum from jsonb_array_elements(p_allocations) x;
  if abs(round(v_sum, 2) - round(v_base, 2)) > 0.005 then
    raise exception 'Allocation does not reconcile: invoice % allocated %', round(v_base, 2), round(v_sum, 2);
  end if;

  for a in select * from jsonb_array_elements(p_allocations) loop
    v_line := null;
    -- A variation raises Agreed: write the extra line, linked to the invoice.
    -- Credit notes never create extras.
    if coalesce((a->>'is_variation')::boolean, false) and v_kind = 'invoice' and (a->>'amount')::numeric > 0 then
      insert into refurb_lines (project_id, kind, amount, date, payee, description, invoice_id)
      values ((a->>'project_id')::uuid, 'extra', (a->>'amount')::numeric,
              coalesce(nullif(p_invoice->>'invoice_date', '')::date, current_date),
              trim(p_invoice->>'supplier_name'),
              'Variation on invoice ' || coalesce(nullif(trim(p_invoice->>'invoice_number'), ''), '(no number)'),
              v_id)
      returning id into v_line;
    end if;
    insert into refurb_invoice_allocations (invoice_id, project_id, property_id, amount, split_method, split_pct, is_variation, extra_line_id)
    values (v_id, (a->>'project_id')::uuid, (a->>'property_id')::uuid, (a->>'amount')::numeric,
            coalesce(a->>'split_method', 'even'), nullif(a->>'split_pct', '')::numeric,
            coalesce((a->>'is_variation')::boolean, false), v_line)
    returning id into v_alloc;
  end loop;

  return v_id;
end;
$$;
revoke all on function public.create_refurb_invoice(jsonb, jsonb) from public, anon;
grant execute on function public.create_refurb_invoice(jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- Verification:
-- select relname, relrowsecurity from pg_class where relname in ('refurb_invoices','refurb_invoice_allocations');
-- select tablename, policyname, cmd from pg_policies where tablename like 'refurb_invoice%';
