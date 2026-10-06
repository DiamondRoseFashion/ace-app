-- ============================================================
-- Only owner / admin / manager can delete projects and meetings.
-- Employees can still add and edit (and mark a meeting Cancelled).
-- "Restrictive" rules apply on top of every other rule, so this
-- holds no matter what other permissions exist.
-- Safe to run more than once.
-- ============================================================

drop policy if exists "only management deletes projects" on public.projects;
create policy "only management deletes projects" on public.projects
  as restrictive for delete
  using (public.my_role() in ('owner', 'admin', 'manager'));

drop policy if exists "only management deletes meetings" on public.meetings;
create policy "only management deletes meetings" on public.meetings
  as restrictive for delete
  using (public.my_role() in ('owner', 'admin', 'manager'));
