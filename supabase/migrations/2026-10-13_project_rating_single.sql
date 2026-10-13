-- ============================================================
-- Project review = ONE rating per project (1–5 stars).
-- Whoever rates last sets it (employee, manager, admin or owner);
-- anyone who can open the project can rate it or clear it.
-- Carries over the newest rating from the earlier per-person
-- ratings table, if it exists. Safe to run more than once.
-- ============================================================
alter table public.projects add column if not exists rating smallint check (rating between 1 and 5);
alter table public.projects add column if not exists rated_by uuid references public.profiles(id) on delete set null;
alter table public.projects add column if not exists rated_at timestamptz;

do $$
begin
  if to_regclass('public.project_ratings') is not null then
    update public.projects p set rating = r.stars, rated_by = r.user_id, rated_at = r.updated_at
    from (
      select distinct on (project_id) project_id, stars, user_id, updated_at
      from public.project_ratings order by project_id, updated_at desc
    ) r
    where r.project_id = p.id and p.rating is null;
  end if;
end $$;
