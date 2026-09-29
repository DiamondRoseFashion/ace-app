-- ============================================================
-- Outlook calendar connection
-- Each person gets a private, secret calendar link. Outlook
-- subscribes to it and shows their ACE meetings. Only the owner
-- can see or reset their own link.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.calendar_feeds (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
drop policy if exists "users see own calendar link" on public.calendar_feeds;
create policy "users see own calendar link" on public.calendar_feeds for select
  using (user_id = auth.uid());

-- returns my link token, creating it the first time
create or replace function public.get_my_calendar_token()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into calendar_feeds (user_id) values (auth.uid())
    on conflict (user_id) do nothing;
  select token into t from calendar_feeds where user_id = auth.uid();
  return t;
end;
$$;

-- makes a new link; the old one stops working immediately
create or replace function public.reset_my_calendar_token()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into calendar_feeds (user_id, token) values (auth.uid(), gen_random_uuid())
    on conflict (user_id) do update set token = gen_random_uuid(), created_at = now()
    returning token into t;
  return t;
end;
$$;
