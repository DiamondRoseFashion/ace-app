-- Employees may delete only meetings they created themselves.
-- (Managers/admins/owner keep full access through their own rule;
--  a project's creator can still manage that project's meetings.)
-- Safe to run more than once.
drop policy if exists "users manage their own meetings" on public.meetings;

drop policy if exists "users see their own meetings" on public.meetings;
create policy "users see their own meetings" on public.meetings for select
  using (assigned_to = auth.uid() or created_by = auth.uid());

drop policy if exists "users add their own meetings" on public.meetings;
create policy "users add their own meetings" on public.meetings for insert
  with check (assigned_to = auth.uid() or created_by = auth.uid());

drop policy if exists "users edit their own meetings" on public.meetings;
create policy "users edit their own meetings" on public.meetings for update
  using (assigned_to = auth.uid() or created_by = auth.uid())
  with check (assigned_to = auth.uid() or created_by = auth.uid());

drop policy if exists "users delete meetings they created" on public.meetings;
create policy "users delete meetings they created" on public.meetings for delete
  using (created_by = auth.uid());
