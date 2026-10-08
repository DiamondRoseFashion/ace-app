-- ============================================================
-- Shared brand list for "Brands Required"
-- Anyone signed in can see every brand and add new ones; the same
-- brand can't be added twice (case-insensitive). Owner/admin/manager
-- can remove a brand from the list (projects keep what they saved).
-- Projects store their chosen brands in projects.brands_required,
-- separated by ", ".
-- Safe to run more than once.
-- ============================================================
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists brands_name_unique on public.brands (lower(trim(name)));

alter table public.brands enable row level security;

drop policy if exists "everyone sees brands" on public.brands;
create policy "everyone sees brands" on public.brands for select
  using (auth.uid() is not null);

drop policy if exists "everyone adds brands" on public.brands;
create policy "everyone adds brands" on public.brands for insert
  with check (auth.uid() is not null);

drop policy if exists "management removes brands" on public.brands;
create policy "management removes brands" on public.brands for delete
  using (public.my_role() in ('owner', 'admin', 'manager'));

-- the old fixed choices are no longer used: clear them from projects
update public.projects set brands_required = null
 where brands_required in ('European', 'Local', 'PRC');
