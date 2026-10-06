-- ============================================================
-- ACE self-monitoring
--  1. app_events      – every error / warning ACE notices
--  2. app_heartbeats  – "last ran at" for each scheduled job
--  3. deletion watch  – every deleted project is recorded, so a
--                       burst of deletions raises an alarm
--  4. schedules       – monitor (every 5 min), nightly backup
--                       (2:00 AM UAE), weekly report (Mon 8:00 AM UAE)
-- Replace PASTE-CRON-SECRET-HERE (3 places) before running.
-- Safe to run more than once.
-- ============================================================

create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  level text not null default 'error' check (level in ('critical', 'error', 'warning', 'info')),
  source text not null default 'server',
  message text not null,
  detail jsonb,
  path text,
  user_id uuid,
  fingerprint text not null,
  alerted_at timestamptz
);
create index if not exists app_events_created_idx on public.app_events (created_at desc);
create index if not exists app_events_pending_idx on public.app_events (alerted_at) where alerted_at is null;
create index if not exists app_events_fp_idx on public.app_events (fingerprint, created_at desc);

alter table public.app_events enable row level security;
drop policy if exists "management reads app events" on public.app_events;
create policy "management reads app events" on public.app_events for select
  using (public.my_role() in ('owner', 'admin', 'manager'));
-- (only the server writes events)

create table if not exists public.app_heartbeats (
  key text primary key,
  at timestamptz not null default now(),
  info jsonb
);
alter table public.app_heartbeats enable row level security;
-- server only; no policies

-- start the clocks so nothing alarms before the first run
insert into public.app_heartbeats (key, at) values
  ('reminders', now()), ('backup', now()), ('monitor', now())
on conflict (key) do nothing;

-- ---------- deletion watch ----------
create or replace function public.log_project_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into app_events (level, source, message, detail, user_id, fingerprint)
  values (
    'info', 'database', 'Project deleted: ' || coalesce(old.name, '(no name)'),
    jsonb_build_object('project_id', old.id, 'name', old.name, 'status', old.status),
    auth.uid(), 'project-deleted'
  );
  return old;
end;
$$;

drop trigger if exists projects_log_delete on public.projects;
create trigger projects_log_delete
  after delete on public.projects
  for each row execute function public.log_project_deleted();

-- ---------- schedules ----------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare j text;
begin
  foreach j in array array['ace-monitor', 'ace-nightly-backup', 'ace-weekly-report'] loop
    begin
      perform cron.unschedule(j);
    exception when others then
      null; -- not scheduled yet
    end;
  end loop;
end $$;

select cron.schedule('ace-monitor', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://app.gemssystems.com/api/monitor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'PASTE-CRON-SECRET-HERE'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
$cron$);

-- 22:00 UTC = 2:00 AM UAE
select cron.schedule('ace-nightly-backup', '0 22 * * *', $cron$
  select net.http_post(
    url := 'https://app.gemssystems.com/api/backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'PASTE-CRON-SECRET-HERE'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);

-- Monday 04:00 UTC = Monday 8:00 AM UAE
select cron.schedule('ace-weekly-report', '0 4 * * 1', $cron$
  select net.http_post(
    url := 'https://app.gemssystems.com/api/weekly-report',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'PASTE-CRON-SECRET-HERE'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
