-- ============================================================
-- Storage check for the Monday weekly report: how much file storage
-- (all buckets) and database space ACE uses, so the report can say
-- when it's time to move to a paid Supabase plan.
-- Only the server (the weekly report) can call it.
-- Safe to run more than once.
-- ============================================================
create or replace function public.storage_usage()
returns table (files_bytes bigint, files_count bigint, db_bytes bigint)
language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint,
         count(*)::bigint,
         pg_database_size(current_database())::bigint
  from storage.objects o;
$$;
revoke all on function public.storage_usage() from public, anon, authenticated;
grant execute on function public.storage_usage() to service_role;

-- Shows the numbers now:
select pg_size_pretty(files_bytes) as files, files_count, pg_size_pretty(db_bytes) as database from public.storage_usage();
