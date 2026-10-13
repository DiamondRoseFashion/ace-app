-- ============================================================
-- Project Notes: besides the "Supported By" people, the project's
-- own salesperson (and management) can add notes too, so both
-- sides see the whole conversation. Notes stay permanent.
-- Safe to run more than once.
-- ============================================================
drop policy if exists "supporters add notes" on public.support_notes;
create policy "supporters add notes" on public.support_notes for insert
  with check (
    author_id = auth.uid()
    and (public.is_project_supporter(project_id)
         or exists (select 1 from public.projects p where p.id = project_id))
  );
