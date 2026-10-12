-- ============================================================
-- Remember each contact person's details (designation, tel,
-- mobile, email) in the shared suggestion list, so picking the
-- same person of the same company on another project fills them
-- in automatically. The newest details saved win; empty boxes
-- never wipe out details saved before.
-- Run after 2026-10-12_contact_names_per_role.sql.
-- Safe to run more than once.
-- ============================================================
alter table public.contact_names add column if not exists designation text;
alter table public.contact_names add column if not exists tel text;
alter table public.contact_names add column if not exists mobile text;
alter table public.contact_names add column if not exists email text;

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
    insert into contact_names (role, kind, company, name, designation, tel, mobile, email)
    values (rl, 'person', co, nm,
            nullif(trim(new.designation), ''), nullif(trim(new.tel), ''),
            nullif(trim(new.mobile), ''), nullif(trim(new.email), ''))
    on conflict (role, kind, lower(trim(company)), lower(trim(name))) do update set
      designation = coalesce(excluded.designation, contact_names.designation),
      tel         = coalesce(excluded.tel, contact_names.tel),
      mobile      = coalesce(excluded.mobile, contact_names.mobile),
      email       = coalesce(excluded.email, contact_names.email);
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_remember_names on public.contacts;
create trigger contacts_remember_names
  after insert or update of company_name, name, contact_role, designation, tel, mobile, email on public.contacts
  for each row execute function public.remember_contact_names();

-- fill details for people already on the list, from their newest saved contact
with latest as (
  select distinct on (contact_role, lower(coalesce(trim(company_name), '')), lower(trim(name)))
    contact_role, coalesce(trim(company_name), '') as company, trim(name) as name,
    nullif(trim(designation), '') as designation, nullif(trim(tel), '') as tel,
    nullif(trim(mobile), '') as mobile, nullif(trim(email), '') as email
  from public.contacts
  where coalesce(trim(name), '') <> ''
  order by contact_role, lower(coalesce(trim(company_name), '')), lower(trim(name)), created_at desc
)
update public.contact_names n set
  designation = coalesce(l.designation, n.designation),
  tel = coalesce(l.tel, n.tel),
  mobile = coalesce(l.mobile, n.mobile),
  email = coalesce(l.email, n.email)
from latest l
where n.kind = 'person' and n.role = l.contact_role
  and lower(trim(n.company)) = lower(l.company) and lower(trim(n.name)) = lower(l.name);
