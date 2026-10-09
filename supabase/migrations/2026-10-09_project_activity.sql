-- ============================================================
-- Project Activity: updates written by the team on each project
-- (e.g. "Called the consultant, samples sent on Monday").
--  • Anyone who can open a project can read its activity and add
--    their own updates (employees: their own projects; management:
--    every project — same rule as the project itself).
--  • People can edit or remove their OWN entries; owner/admin/
--    manager can remove any entry.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists project_activity_project_idx on public.project_activity (project_id, created_at desc);

alter table public.project_activity enable row level security;

-- the projects subquery is itself limited by the projects rules,
-- so "can see the project" = "can see its activity"
drop policy if exists "see activity of visible projects" on public.project_activity;
create policy "see activity of visible projects" on public.project_activity for select
  using (exists (select 1 from public.projects p where p.id = project_id));

drop policy if exists "add own activity to visible projects" on public.project_activity;
create policy "add own activity to visible projects" on public.project_activity for insert
  with check (author_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id));

drop policy if exists "edit own activity" on public.project_activity;
create policy "edit own activity" on public.project_activity for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "remove own activity or management" on public.project_activity;
create policy "remove own activity or management" on public.project_activity for delete
  using (author_id = auth.uid() or public.my_role() in ('owner', 'admin', 'manager'));

-- live updates (new entries appear without refreshing)
do $$
begin
  alter publication supabase_realtime add table public.project_activity;
exception when others then
  null; -- already added
end $$;
