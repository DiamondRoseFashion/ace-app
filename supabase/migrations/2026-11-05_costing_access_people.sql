-- ============================================================
-- Costing sheets: give access to named people (as well as Admin).
--  • costing_access: who may use costing sheets besides Admin.
--    Access is given only from this SQL editor (nobody can add
--    themselves from the app).
--  • First people: Anjo and Alwin.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.costing_access (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table public.costing_access enable row level security;
drop policy if exists "see own costing access" on public.costing_access;
create policy "see own costing access" on public.costing_access for select using (user_id = auth.uid());
-- (no insert/update/delete policies: only the SQL editor can change access)

create or replace function public.has_costing_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
      or exists (select 1 from public.costing_access where user_id = auth.uid());
$$;

insert into public.costing_access (user_id)
select id from public.profiles
where full_name ilike '%anjo%' or full_name ilike '%alwin%'
on conflict do nothing;

-- Shows who has costing access now (Admins always have it too):
select p.full_name, p.role from public.costing_access a join public.profiles p on p.id = a.user_id order by p.full_name;
