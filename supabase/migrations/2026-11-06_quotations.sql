-- ============================================================
-- Quotations made from a costing sheet (costing sheet → "Quotation").
--  • One quotation per costing sheet revision (R0, R1 …).
--  • Keeps the client details (To / P.O. Box / Tel / Attn.), Ref,
--    Date, Project, the opening text, the items as they were when last
--    taken from the costing sheet ("Update from costing sheet"), the
--    terms & conditions, delivery / payment / validity and the
--    salesman's name. Only selling prices are kept: never costs.
--  • Same access as costing sheets (has_costing_access).
-- Safe to run more than once.
-- ============================================================
create table if not exists public.quotation_docs (
  id uuid primary key default gen_random_uuid(),
  costing_sheet_id uuid not null unique references public.costing_sheets(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  to_company text,
  po_box text,
  city text,
  tel text,
  attn text,
  ref_no text,
  quote_date date,
  project_name text,
  salutation text,
  intro text,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  vat_percent numeric not null default 5 check (vat_percent >= 0 and vat_percent <= 100),
  terms jsonb not null default '[]'::jsonb check (jsonb_typeof(terms) = 'array'),
  delivery text,
  payment text,
  validity text,
  closing text,
  salesman text,
  synced_at timestamptz,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quotation_docs_project_idx on public.quotation_docs (project_id);

alter table public.quotation_docs enable row level security;
drop policy if exists "costing access" on public.quotation_docs;
create policy "costing access" on public.quotation_docs for all
  using (public.has_costing_access())
  with check (public.has_costing_access());

create or replace function public.quotation_docs_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.costing_sheet_id := old.costing_sheet_id;
    new.project_id := old.project_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists quotation_docs_guard on public.quotation_docs;
create trigger quotation_docs_guard before insert or update on public.quotation_docs
  for each row execute function public.quotation_docs_guard();

-- Shows the new table is ready (0 quotations at first):
select count(*) as quotations from public.quotation_docs;
