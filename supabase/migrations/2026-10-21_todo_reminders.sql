-- ============================================================
-- To-Do notifications (sent by the every-minute reminder job):
--  • remind_at: "Remind me" time on a to-do → push notification.
--  • assign_notified_at: when someone gives you a to-do you get a
--    notification (also when a to-do is passed on to you).
--  • todo_access.digest_date: the 8 AM "due today" summary is sent
--    once per day per person.
-- Safe to run more than once.
-- ============================================================
alter table public.todos add column if not exists remind_at timestamptz;
alter table public.todos add column if not exists remind_sent_at timestamptz;
alter table public.todos add column if not exists assign_notified_at timestamptz;
alter table public.todo_access add column if not exists digest_date date;
create index if not exists todos_remind_idx on public.todos (remind_at) where done_at is null and remind_sent_at is null;

-- old to-dos: nothing to announce
update public.todos set assign_notified_at = coalesce(assign_notified_at, created_at);

create or replace function public.todos_new_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.remind_sent_at := null;
  -- my own to-do: no "new to-do" notification needed
  new.assign_notified_at := case when new.assigned_to = new.created_by then now() else null end;
  return new;
end;
$$;
drop trigger if exists todos_new_guard on public.todos;
create trigger todos_new_guard before insert on public.todos
  for each row execute function public.todos_new_guard();

create or replace function public.todos_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.done_at is not null and old.done_at is null then
    new.done_by := auth.uid();
  elsif new.done_at is null then
    new.done_by := null;
  end if;
  -- the app can't fake "already sent"; only the reminder job (no app user) sets these
  if auth.uid() is not null then
    new.remind_sent_at := old.remind_sent_at;
    new.assign_notified_at := old.assign_notified_at;
    if new.remind_at is distinct from old.remind_at then new.remind_sent_at := null; end if;
    if new.assigned_to is distinct from old.assigned_to then
      new.assign_notified_at := case when new.assigned_to = auth.uid() then now() else null end;
    end if;
  end if;
  return new;
end;
$$;
