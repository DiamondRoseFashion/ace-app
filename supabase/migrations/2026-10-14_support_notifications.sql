-- ============================================================
-- "New project to support" notifications.
--  • project_supporters.seen_at: empty until the supporter opens
--    their Support page.
--  • my_new_support(): my assigned projects I haven't seen yet
--    (project name, sales person, who assigned it).
--  • mark_support_seen(): marks them all as seen.
-- Safe to run more than once.
-- ============================================================
alter table public.project_supporters add column if not exists seen_at timestamptz;
-- projects already assigned before today count as seen
update public.project_supporters set seen_at = created_at where seen_at is null and created_at < now() - interval '1 minute';

create or replace function public.my_new_support()
returns table (project_id uuid, project_name text, sales_person text, assigned_by text, assigned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.sales_person, coalesce(a.full_name, ''), s.created_at
  from project_supporters s
  join projects p on p.id = s.project_id
  left join profiles a on a.id = s.added_by
  where s.user_id = auth.uid() and s.seen_at is null
  order by s.created_at desc;
$$;
revoke all on function public.my_new_support() from public, anon;
grant execute on function public.my_new_support() to authenticated;

create or replace function public.mark_support_seen()
returns void language sql volatile security definer set search_path = public as $$
  update project_supporters set seen_at = now() where user_id = auth.uid() and seen_at is null;
$$;
revoke all on function public.mark_support_seen() from public, anon;
grant execute on function public.mark_support_seen() to authenticated;
