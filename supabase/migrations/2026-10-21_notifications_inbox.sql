-- ============================================================
-- Notification inbox (the 🔔 bell at the top of ACE).
--  • Every notification ACE sends (meeting reminders, new meetings,
--    projects to support, to-do reminders, …) is also saved here,
--    so people can read it later — even without phone notifications.
--  • New project notes are added here too (inbox only).
--  • Each person sees, marks read and deletes only their own.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'info',
  title text not null,
  body text,
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
drop policy if exists "see my notifications" on public.notifications;
create policy "see my notifications" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "update my notifications" on public.notifications;
create policy "update my notifications" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete my notifications" on public.notifications;
create policy "delete my notifications" on public.notifications for delete using (user_id = auth.uid());
-- (no insert policy: only the server and the triggers below add notifications)

-- people can only mark read / unread, not change the text
create or replace function public.notifications_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.user_id := old.user_id; new.kind := old.kind; new.title := old.title;
    new.body := old.body; new.url := old.url; new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_guard on public.notifications;
create trigger notifications_guard before update on public.notifications
  for each row execute function public.notifications_guard();

-- New project note → tell the salesperson and the other supporters
create or replace function public.notify_new_support_note()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p record;
  author text;
  snippet text;
begin
  select id, name, created_by into p from projects where id = new.project_id;
  if p.id is null then return new; end if;
  select coalesce(nullif(trim(full_name), ''), 'Someone') into author from profiles where id = new.author_id;
  snippet := left(regexp_replace(new.body, '\s+', ' ', 'g'), 140);
  insert into notifications (user_id, kind, title, body, url)
  select x.uid, 'note', '💬 New note: ' || coalesce(p.name, 'project'), coalesce(author, 'Someone') || ': ' || snippet, x.url
  from (
    select p.created_by as uid, '/project/' || p.id as url
    union
    select s.user_id, '/support' from project_supporters s where s.project_id = p.id and s.user_id <> coalesce(p.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
  ) x
  where x.uid is not null and x.uid <> new.author_id;
  return new;
end;
$$;
drop trigger if exists notify_new_support_note on public.support_notes;
create trigger notify_new_support_note after insert on public.support_notes
  for each row execute function public.notify_new_support_note();

do $$ begin alter publication supabase_realtime add table public.notifications; exception when others then null; end $$;
