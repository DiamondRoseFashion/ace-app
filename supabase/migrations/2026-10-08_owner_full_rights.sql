-- ============================================================
-- Give the OWNER every right a manager/admin has. Three original
-- rules listed admin/manager/employee but forgot 'owner':
--   1. seeing other people's profiles
--   2. editing other people's profiles
--   3. project files (upload / view / download)
-- These rules only ADD access for the owner; nothing else changes.
-- Safe to run more than once.
-- ============================================================

drop policy if exists "owner sees all profiles" on public.profiles;
create policy "owner sees all profiles" on public.profiles for select
  using (public.my_role() = 'owner');

drop policy if exists "owner manages profiles" on public.profiles;
create policy "owner manages profiles" on public.profiles for update
  using (public.my_role() = 'owner')
  with check (public.my_role() = 'owner');

drop policy if exists "owner manages project files" on storage.objects;
create policy "owner manages project files" on storage.objects for all
  using (bucket_id = 'project-files' and public.my_role() = 'owner')
  with check (bucket_id = 'project-files' and public.my_role() = 'owner');
