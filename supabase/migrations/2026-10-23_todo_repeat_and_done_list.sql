-- ============================================================
-- To-Do:
--  • "Repeat every day" reminders, from a start date until an
--    (optional) end date. The reminder job moves remind_at on by a
--    day after each one.
--  • Finished to-dos stay in a "Done" list for 7 days (then the
--    reminder job deletes them). The person doing it can delete a
--    finished to-do sooner; the person who made it can delete any.
-- Safe to run more than once.
-- ============================================================
alter table public.todos add column if not exists remind_repeat text not null default 'none';
alter table public.todos add column if not exists remind_until date;
do $$ begin
  alter table public.todos add constraint todos_remind_repeat_check check (remind_repeat in ('none', 'daily'));
exception when duplicate_object then null; end $$;
create index if not exists todos_done_idx on public.todos (done_at) where done_at is not null;

drop policy if exists "delete todos I made" on public.todos;
create policy "delete todos I made" on public.todos for delete
  using (public.has_todo_access() and (created_by = auth.uid() or (assigned_to = auth.uid() and done_at is not null)));

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
    if new.remind_at is distinct from old.remind_at
       or new.remind_repeat is distinct from old.remind_repeat
       or new.remind_until is distinct from old.remind_until then
      new.remind_sent_at := null;
    end if;
    if new.assigned_to is distinct from old.assigned_to then
      new.assign_notified_at := case when new.assigned_to = auth.uid() then now() else null end;
    end if;
  end if;
  return new;
end;
$$;
