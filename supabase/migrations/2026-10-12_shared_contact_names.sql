-- ============================================================
-- Shared Company / Name suggestions for project contacts
--  • Every company name and person name saved on ANY project's
--    contacts is added to one shared list, automatically (by the
--    database, whoever saved it).
--  • Everyone signed in can see the list and pick from it in the
--    Company name / Name boxes; new names can still be typed.
--  • Each person remembers their company, so after picking a
--    company, that company's people are suggested first.
--  • No duplicates (case-insensitive). Owner/admin/manager can
--    remove an entry.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.contact_names (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('company', 'person')),
  company text not null default '',            -- for people: their company
  name text not null check (length(trim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);
create unique index if not exists contact_names_unique
  on public.contact_names (kind, lower(trim(company)), lower(trim(name)));

alter table public.contact_names enable row level security;

drop policy if exists "everyone sees contact names" on public.contact_names;
create policy "everyone sees contact names" on public.contact_names for select
  using (auth.uid() is not null);

drop policy if exists "management removes contact names" on public.contact_names;
create policy "management removes contact names" on public.contact_names for delete
  using (public.my_role() in ('owner', 'admin', 'manager'));
-- (no insert policy: only the trigger below adds names)

create or replace function public.remember_contact_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  co text := coalesce(trim(new.company_name), '');
  nm text := coalesce(trim(new.name), '');
begin
  if co <> '' then
    insert into contact_names (kind, company, name) values ('company', '', co)
    on conflict do nothing;
  end if;
  if nm <> '' then
    insert into contact_names (kind, company, name) values ('person', co, nm)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_remember_names on public.contacts;
create trigger contacts_remember_names
  after insert or update of company_name, name on public.contacts
  for each row execute function public.remember_contact_names();

-- add everything already saved
insert into public.contact_names (kind, company, name)
select distinct on (lower(trim(company_name))) 'company', '', trim(company_name)
from public.contacts where coalesce(trim(company_name), '') <> ''
on conflict do nothing;

insert into public.contact_names (kind, company, name)
select distinct on (lower(coalesce(trim(company_name), '')), lower(trim(name)))
  'person', coalesce(trim(company_name), ''), trim(name)
from public.contacts where coalesce(trim(name), '') <> ''
on conflict do nothing;
