-- ============================================================
-- Meetings planner (daily / weekly planner with reminders)
--
-- Extends the existing meetings table so meetings logged on
-- projects appear in the planner too. A meeting can now:
--   * have a title and start / end time
--   * stand alone (project is optional)
--   * be assigned to a person (management can assign anyone;
--     employees schedule only for themselves)
--   * be marked done
--   * carry its own reminder (minutes before start)
-- Each user also gets a default reminder setting.
--
-- Includes the profile self-edit fix (safe if already run).
-- Safe to run more than once.
-- ============================================================

-- ---------- meetings: new columns ----------
alter table public.meetings add column if not exists title text;
alter table public.meetings add column if not exists start_time time;
alter table public.meetings add column if not exists end_time time;
alter table public.meetings add column if not exists created_by uuid references public.profiles(id);
alter table public.meetings add column if not exists assigned_to uuid references public.profiles(id);
alter table public.meetings add column if not exists is_done boolean not null default false;
alter table public.meetings add column if not exists reminder_minutes int;

create index if not exists meetings_assigned_date_idx on public.meetings (assigned_to, meeting_date);
create index if not exists meetings_date_idx on public.meetings (meeting_date);

-- ---------- profiles: default reminder per person ----------
alter table public.profiles add column if not exists reminder_default_minutes int not null default 30;

-- ---------- existing project meetings belong to the project's creator ----------
update public.meetings m
set created_by = p.created_by,
    assigned_to = coalesce(m.assigned_to, p.created_by)
from public.projects p
where p.id = m.project_id
  and m.created_by is null;

-- ---------- guard: who may create / change which meetings ----------
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

  -- employees: only link to their own projects
  if new.project_id is not null
     and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
     and not exists (select 1 from projects
                     where id = new.project_id and created_by = auth.uid()) then
    raise exception 'You can only link meetings to your own projects';
  end if;

  return new;
end;
$$;

drop trigger if exists meetings_guard on public.meetings;
create trigger meetings_guard
  before insert or update on public.meetings
  for each row execute function public.meetings_guard();

-- ---------- visibility: your own meetings ----------
-- (existing rules stay: management sees all; project creators see
--  their projects' meetings)
drop policy if exists "users manage their own meetings" on public.meetings;
create policy "users manage their own meetings" on public.meetings for all
  using (assigned_to = auth.uid() or created_by = auth.uid())
  with check (assigned_to = auth.uid() or created_by = auth.uid());

-- ============================================================
-- Profile self-edit fix + role protection (same as
-- 2026-09-25_profile_self_edit_and_role_protection.sql)
-- ============================================================
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.protect_role_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  if new.role is not distinct from old.role then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  actor_role := public.my_role();
  if actor_role in ('owner', 'admin') then
    return new;
  end if;
  if actor_role = 'manager'
     and new.id <> auth.uid()
     and old.role in ('manager', 'employee')
     and new.role in ('manager', 'employee') then
    return new;
  end if;
  raise exception 'You are not allowed to make this role change';
end;
$$;

drop trigger if exists protect_role_changes on public.profiles;
create trigger protect_role_changes
  before update on public.profiles
  for each row execute function public.protect_role_changes();
