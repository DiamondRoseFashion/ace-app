-- ============================================================
-- Meeting status: Pending / Completed / Cancelled / Postponed
--
-- `status` is the source of truth. The older `is_done` tick is
-- kept in sync automatically (is_done = status is Completed), so
-- reminders, Outlook and older screens keep working unchanged.
-- `status_changed_at` records when the status last changed.
-- Safe to run more than once.
-- ============================================================

alter table public.meetings add column if not exists status text not null default 'pending';
alter table public.meetings add column if not exists status_changed_at timestamptz;

alter table public.meetings drop constraint if exists meetings_status_check;
alter table public.meetings add constraint meetings_status_check
  check (status in ('pending', 'completed', 'cancelled', 'postponed'));

-- existing ticked meetings become Completed
update public.meetings set status = 'completed'
where is_done = true and status = 'pending';

create index if not exists meetings_status_idx on public.meetings (status);

create or replace function public.meetings_status_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is null then
      new.status := 'pending';
    end if;
    if new.is_done and new.status = 'pending' then
      new.status := 'completed';
    end if;
    new.is_done := (new.status = 'completed');
    if new.status <> 'pending' then
      new.status_changed_at := now();
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    -- status chosen directly (status menu)
    new.is_done := (new.status = 'completed');
    new.status_changed_at := now();
  elsif new.is_done is distinct from old.is_done then
    -- tick-box / "Done" button used
    new.status := case when new.is_done then 'completed' else 'pending' end;
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists meetings_status_sync on public.meetings;
create trigger meetings_status_sync
  before insert or update on public.meetings
  for each row execute function public.meetings_status_sync();
