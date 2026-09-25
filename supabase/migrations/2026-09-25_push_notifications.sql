-- ============================================================
-- Background meeting reminders (push notifications)
--  1. push_subscriptions: each phone/computer a person turned
--     notifications on for
--  2. meetings.push_sent_key: remembers which reminder was already
--     pushed, so nobody gets the same one twice
--  3. every-minute schedule that asks ACE to send due reminders
-- Safe to run more than once.
-- ============================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "users see own devices" on public.push_subscriptions;
create policy "users see own devices" on public.push_subscriptions for select
  using (user_id = auth.uid());
drop policy if exists "users remove own devices" on public.push_subscriptions;
create policy "users remove own devices" on public.push_subscriptions for delete
  using (user_id = auth.uid());

-- register this device to whoever is signed in (a shared device moves
-- to the latest person who signed in on it)
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from push_subscriptions where endpoint = p_endpoint;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent);
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

alter table public.meetings add column if not exists push_sent_key text;

-- ---------- every-minute schedule ----------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('ace-meeting-reminders');
exception when others then
  null; -- not scheduled yet
end $$;

select cron.schedule(
  'ace-meeting-reminders',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://app.gemssystems.com/api/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'PASTE-CRON-SECRET-HERE'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);
