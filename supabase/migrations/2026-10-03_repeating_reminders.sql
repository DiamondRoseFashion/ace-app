-- ============================================================
-- Repeating reminder notifications
-- A reminder notification repeats every minute (up to 10 times)
-- until the person presses Stop / Snooze, taps or dismisses it, or
-- stops the alarm inside ACE. Each person can switch repeats off.
-- Safe to run more than once.
-- ============================================================
alter table public.meetings add column if not exists push_repeat_count int not null default 0;
alter table public.meetings add column if not exists push_last_sent_at timestamptz;
alter table public.meetings add column if not exists push_ack_at timestamptz;
alter table public.meetings add column if not exists push_snooze_until timestamptz;

alter table public.profiles add column if not exists reminder_repeat boolean not null default true;

-- Used by the in-app alarm: Stop (minutes = 0) or Snooze (minutes > 0)
create or replace function public.ack_meeting_reminder(p_meeting uuid, p_snooze_minutes int default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(p_snooze_minutes, 0) > 0 then
    update meetings
       set push_snooze_until = now() + make_interval(mins => p_snooze_minutes),
           push_repeat_count = least(push_repeat_count, 9)
     where id = p_meeting
       and (assigned_to = auth.uid() or my_role() in ('owner', 'admin', 'manager'));
  else
    update meetings
       set push_ack_at = now()
     where id = p_meeting
       and (assigned_to = auth.uid() or my_role() in ('owner', 'admin', 'manager'));
  end if;
end;
$$;
