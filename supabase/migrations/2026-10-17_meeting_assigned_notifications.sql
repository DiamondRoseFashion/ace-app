-- ============================================================
-- "New meeting assigned to you" notifications.
--  • meetings.assignee_seen_at: empty while the person a meeting is
--    assigned to (by someone else) hasn't opened their Meetings page.
--    Reset whenever a meeting is given to a different person.
--  • my_new_meetings(): meetings others gave me that I haven't seen.
--  • mark_meetings_seen(): marks them all as seen.
-- Safe to run more than once.
-- ============================================================
alter table public.meetings add column if not exists assignee_seen_at timestamptz;
update public.meetings set assignee_seen_at = coalesce(created_at, now()) where assignee_seen_at is null;

create or replace function public.meetings_assignee_seen()
returns trigger language plpgsql as $$
begin
  if new.assigned_to is null or new.assigned_to = coalesce(new.created_by, auth.uid()) then
    new.assignee_seen_at := coalesce(new.assignee_seen_at, now()); -- my own meeting: nothing to announce
  elsif tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
    new.assignee_seen_at := null; -- given to someone new: announce it
  end if;
  return new;
end;
$$;

-- runs after meetings_guard (triggers run in name order)
drop trigger if exists zz_meetings_assignee_seen on public.meetings;
create trigger zz_meetings_assignee_seen
  before insert or update of assigned_to on public.meetings
  for each row execute function public.meetings_assignee_seen();

create or replace function public.my_new_meetings()
returns table (meeting_id uuid, title text, meeting_date date, start_time time, venue text, assigned_by text, project_name text)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.meeting_date, m.start_time, m.venue, coalesce(c.full_name, ''),
         coalesce(p.name, m.project_name)
  from meetings m
  left join profiles c on c.id = m.created_by
  left join projects p on p.id = m.project_id
  where m.assigned_to = auth.uid() and m.assignee_seen_at is null
    and coalesce(m.created_by, auth.uid()) <> auth.uid()
  order by m.created_at desc;
$$;
revoke all on function public.my_new_meetings() from public, anon;
grant execute on function public.my_new_meetings() to authenticated;

create or replace function public.mark_meetings_seen()
returns void language sql volatile security definer set search_path = public as $$
  update meetings set assignee_seen_at = now() where assigned_to = auth.uid() and assignee_seen_at is null;
$$;
revoke all on function public.mark_meetings_seen() from public, anon;
grant execute on function public.mark_meetings_seen() to authenticated;
