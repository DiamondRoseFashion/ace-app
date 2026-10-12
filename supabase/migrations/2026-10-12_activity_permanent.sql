-- ============================================================
-- Project Activity is permanent: once an update is saved, nobody
-- (employee, manager, admin or owner) can edit or delete it from
-- the app. Entries only go away if the whole project is deleted.
-- Safe to run more than once.
-- ============================================================
drop policy if exists "edit own activity" on public.project_activity;
drop policy if exists "remove own activity or management" on public.project_activity;
