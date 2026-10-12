-- ============================================================
-- Company / Name suggestions: a SEPARATE list for each contact
-- section (Contractor, Client, Consultant, Main Contractor).
-- Run after 2026-10-12_shared_contact_names.sql. Safe to run more
-- than once.
-- ============================================================
alter table public.contact_names add column if not exists role text not null default '';

drop index if exists public.contact_names_unique;
create unique index if not exists contact_names_role_unique
  on public.contact_names (role, kind, lower(trim(company)), lower(trim(name)));

create or replace function public.remember_contact_names()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rl text := coalesce(new.contact_role, '');
  co text := coalesce(trim(new.company_name), '');
  nm text := coalesce(trim(new.name), '');
begin
  if co <> '' then
    insert into contact_names (role, kind, company, name) values (rl, 'company', '', co) on conflict do nothing;
  end if;
  if nm <> '' then
    insert into contact_names (role, kind, company, name) values (rl, 'person', co, nm) on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_remember_names on public.contacts;
create trigger contacts_remember_names
  after insert or update of company_name, name, contact_role on public.contacts
  for each row execute function public.remember_contact_names();

-- rebuild the lists from every saved contact, per section
delete from public.contact_names where role = '';

insert into public.contact_names (role, kind, company, name)
select distinct on (contact_role, lower(trim(company_name))) contact_role, 'company', '', trim(company_name)
from public.contacts where coalesce(trim(company_name), '') <> ''
on conflict do nothing;

insert into public.contact_names (role, kind, company, name)
select distinct on (contact_role, lower(coalesce(trim(company_name), '')), lower(trim(name)))
  contact_role, 'person', coalesce(trim(company_name), ''), trim(name)
from public.contacts where coalesce(trim(name), '') <> ''
on conflict do nothing;
