-- ============================================================
-- 🔔 "New note" notifications open the exact project:
--  • the salesperson → that project's page (as before)
--  • supporters → that project's notes on the Support page
--    (/support?project=<id>) instead of the Support page in general.
-- Safe to run more than once.
-- ============================================================
create or replace function public.notify_new_support_note()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p record;
  author text;
  snippet text;
begin
  select id, name, created_by into p from projects where id = new.project_id;
  if p.id is null then return new; end if;
  select coalesce(nullif(trim(full_name), ''), 'Someone') into author from profiles where id = new.author_id;
  snippet := left(regexp_replace(new.body, '\s+', ' ', 'g'), 140);
  insert into notifications (user_id, kind, title, body, url)
  select x.uid, 'note', '💬 New note: ' || coalesce(p.name, 'project'), coalesce(author, 'Someone') || ': ' || snippet, x.url
  from (
    select p.created_by as uid, '/project/' || p.id as url
    union
    select s.user_id, '/support?project=' || p.id from project_supporters s where s.project_id = p.id and s.user_id <> coalesce(p.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
  ) x
  where x.uid is not null and x.uid <> new.author_id;
  return new;
end;
$$;

-- Shows the update is in place (should say: yes):
select case when prosrc like '%/support?project=%' then 'yes' else 'no' end as note_links_updated
from pg_proc where proname = 'notify_new_support_note';
