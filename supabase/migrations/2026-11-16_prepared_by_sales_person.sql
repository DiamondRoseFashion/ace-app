-- ============================================================
-- "Prepared By" on projects, and projects showing for their
-- Sales Person.
--  • projects.prepared_by: the person who prepared the project (and
--    its costing sheet / quotation) for a sales person. Optional.
--  • sales_people: links each name in the Sales Person list (ALWIN,
--    ANJO, BIJU …) to that person's ACE account. Filled in below by
--    matching first names; check the list at the end and fix any row
--    with the one-line update shown there.
--  • projects.sales_user_id: the Sales Person's account, kept up to
--    date automatically from the Sales Person name.
--  • A project is now also visible and editable for its Prepared By
--    person and its Sales Person (as well as whoever created it, and
--    management). Only management can delete, as before.
--  • New project notes also notify the Sales Person / Prepared By.
-- Safe to run more than once.
-- ============================================================

alter table public.projects add column if not exists prepared_by uuid references public.profiles(id) on delete set null;
alter table public.projects add column if not exists sales_user_id uuid references public.profiles(id) on delete set null;
create index if not exists projects_prepared_by_idx on public.projects (prepared_by);
create index if not exists projects_sales_user_idx on public.projects (sales_user_id);

-- ---------- Sales Person name → account ----------
create table if not exists public.sales_people (
  name text primary key check (name = upper(trim(name)) and length(name) between 1 and 60),
  user_id uuid references public.profiles(id) on delete set null
);
alter table public.sales_people enable row level security;
drop policy if exists "everyone sees sales people" on public.sales_people;
create policy "everyone sees sales people" on public.sales_people for select using (auth.uid() is not null);
-- (no insert/update/delete policies: changed only from this SQL editor)

insert into public.sales_people (name) values
  ('AKSHAY'), ('ALWIN'), ('ANJO'), ('BIJU'), ('GEORGE'), ('HARIES'),
  ('INDRAJITH'), ('RAJAT'), ('SARATH'), ('SIDHARTH'), ('SINEESH')
on conflict (name) do nothing;

-- link by first name, only where exactly one account has that first name
update public.sales_people sp
   set user_id = (select p.id from public.profiles p where upper(split_part(trim(p.full_name), ' ', 1)) = sp.name)
 where sp.user_id is null
   and (select count(*) from public.profiles p where upper(split_part(trim(p.full_name), ' ', 1)) = sp.name) = 1;

create or replace function public.sales_user_for(p_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from sales_people where name = upper(trim(coalesce(p_name, '')));
$$;

-- keep projects.sales_user_id in line with the Sales Person name
create or replace function public.set_project_sales_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.sales_user_id := public.sales_user_for(new.sales_person);
  return new;
end;
$$;
drop trigger if exists projects_sales_user on public.projects;
create trigger projects_sales_user before insert or update on public.projects
  for each row execute function public.set_project_sales_user();

update public.projects
   set sales_user_id = public.sales_user_for(sales_person)
 where sales_user_id is distinct from public.sales_user_for(sales_person);

-- ---------- who works on a project ----------
create or replace function public.is_project_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects
    where id = p_project
      and auth.uid() is not null
      and auth.uid() in (created_by, prepared_by, sales_user_id)
  );
$$;
revoke all on function public.is_project_member(uuid) from public, anon;
grant execute on function public.is_project_member(uuid) to authenticated;

-- Prepared By / Sales Person can see and edit the project (added to the
-- existing rules; deleting stays management-only)
drop policy if exists "prepared by or sales person see project" on public.projects;
create policy "prepared by or sales person see project" on public.projects for select
  using (prepared_by = auth.uid() or sales_user_id = auth.uid());
drop policy if exists "prepared by or sales person edit project" on public.projects;
create policy "prepared by or sales person edit project" on public.projects for update
  using (prepared_by = auth.uid() or sales_user_id = auth.uid())
  with check (prepared_by = auth.uid() or sales_user_id = auth.uid() or created_by = auth.uid());

-- … and its contacts, quotations and meetings
drop policy if exists "project team manages contacts" on public.contacts;
create policy "project team manages contacts" on public.contacts for all
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));
drop policy if exists "project team manages quotations" on public.quotations;
create policy "project team manages quotations" on public.quotations for all
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));
drop policy if exists "project team manages meetings" on public.meetings;
create policy "project team manages meetings" on public.meetings for all
  using (project_id is not null and public.is_project_member(project_id))
  with check (project_id is not null and public.is_project_member(project_id));

-- employees may link meetings to any project they work on (not only ones they created)
create or replace function public.meetings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  -- dashboard / server changes have no logged-in app user
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.assigned_to is null then
      new.assigned_to := auth.uid();
    end if;
  else
    new.created_by := old.created_by;
  end if;

  actor_role := public.my_role();
  if actor_role in ('owner', 'admin', 'manager') then
    return new;
  end if;

  -- employees: only schedule for themselves
  if new.assigned_to is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    raise exception 'You can only schedule meetings for yourself';
  end if;

  -- employees: only link to projects they work on
  if new.project_id is not null
     and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
     and not public.is_project_member(new.project_id) then
    raise exception 'You can only link meetings to your own projects';
  end if;

  return new;
end;
$$;

-- ---------- new project note → also tell the Sales Person / Prepared By ----------
create or replace function public.notify_new_support_note()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p record;
  author text;
  snippet text;
begin
  select id, name, created_by, prepared_by, sales_user_id into p from projects where id = new.project_id;
  if p.id is null then return new; end if;
  select coalesce(nullif(trim(full_name), ''), 'Someone') into author from profiles where id = new.author_id;
  snippet := left(regexp_replace(new.body, '\s+', ' ', 'g'), 140);
  insert into notifications (user_id, kind, title, body, url)
  select distinct on (x.uid) x.uid, 'note', '💬 New note: ' || coalesce(p.name, 'project'), coalesce(author, 'Someone') || ': ' || snippet, x.url
  from (
    select p.created_by as uid, '/project/' || p.id as url, 1 as pref
    union all select p.prepared_by, '/project/' || p.id, 1
    union all select p.sales_user_id, '/project/' || p.id, 1
    union all
    select s.user_id, '/support?project=' || p.id, 2 from project_supporters s where s.project_id = p.id
  ) x
  where x.uid is not null and x.uid <> new.author_id
  order by x.uid, x.pref;
  return new;
end;
$$;

-- ---------- quotations: the Sales Person shown under the date ----------
alter table public.quotation_docs add column if not exists sales_person text;

-- Check this list: each Sales Person should show the right person.
-- To fix one, run for example:
--   update public.sales_people set user_id = (select id from public.profiles where full_name = 'Alwin K George') where name = 'ALWIN';
select sp.name as sales_person, coalesce(p.full_name, '— not linked —') as ace_account
from public.sales_people sp left join public.profiles p on p.id = sp.user_id
order by sp.name;
