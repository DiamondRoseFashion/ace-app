-- One script for the per-section lists + remembered details (use this one; safe to run more than once).
alter table public.contact_names add column if not exists role text not null default '';
drop index if exists public.contact_names_unique;
create unique index if not exists contact_names_role_unique
  on public.contact_names (role, kind, lower(trim(company)), lower(trim(name)));
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
delete from public.contact_names where role = '';
insert into public.contact_names (role, kind, company, name)
select distinct on (contact_role, lower(trim(company_name))) contact_role, 'company', '', trim(company_name)
from public.contacts where coalesce(trim(company_name), '') <> ''
on conflict do nothing;
insert into public.contact_names (role, kind, company, name, designation, tel, mobile, email)
select contact_role, 'person',
  (array_agg(coalesce(trim(company_name), '') order by created_at))[1],
  (array_agg(trim(name) order by created_at))[1],
  (array_agg(nullif(trim(designation), '') order by created_at desc) filter (where nullif(trim(designation), '') is not null))[1],
  (array_agg(nullif(trim(tel), '') order by created_at desc) filter (where nullif(trim(tel), '') is not null))[1],
  (array_agg(nullif(trim(mobile), '') order by created_at desc) filter (where nullif(trim(mobile), '') is not null))[1],
  (array_agg(nullif(trim(email), '') order by created_at desc) filter (where nullif(trim(email), '') is not null))[1]
from public.contacts where coalesce(trim(name), '') <> ''
group by contact_role, lower(coalesce(trim(company_name), '')), lower(trim(name))
on conflict (role, kind, lower(trim(company)), lower(trim(name))) do update set
  designation = coalesce(excluded.designation, contact_names.designation),
  tel         = coalesce(excluded.tel, contact_names.tel),
  mobile      = coalesce(excluded.mobile, contact_names.mobile),
  email       = coalesce(excluded.email, contact_names.email);
