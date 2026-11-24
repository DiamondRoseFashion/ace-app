-- ============================================================
-- Meetings: employees may also give a meeting to someone else
-- (before, only owner / admin / manager could).
--  • The person who made the meeting keeps seeing and editing it.
--  • Employees still link meetings only to projects they work on.
-- Safe to run more than once.
-- ============================================================
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

  -- employees: may assign to anyone, but only to a real ACE user
  if new.assigned_to is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from profiles where id = new.assigned_to) then
    raise exception 'Please pick a person from the list';
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
