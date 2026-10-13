-- ============================================================
-- Project reviews: 1–5 stars. Each person (employee, manager,
-- admin, owner) gives their own rating to a project they can open
-- and can change or remove it; My Projects shows the average.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.project_ratings (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.project_ratings enable row level security;
drop policy if exists "see ratings of visible projects" on public.project_ratings;
create policy "see ratings of visible projects" on public.project_ratings for select
  using (exists (select 1 from public.projects p where p.id = project_id));
drop policy if exists "rate visible projects" on public.project_ratings;
create policy "rate visible projects" on public.project_ratings for insert
  with check (user_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id));
drop policy if exists "change own rating" on public.project_ratings;
create policy "change own rating" on public.project_ratings for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove own rating" on public.project_ratings;
create policy "remove own rating" on public.project_ratings for delete
  using (user_id = auth.uid());

do $$ begin alter publication supabase_realtime add table public.project_ratings; exception when others then null; end $$;
