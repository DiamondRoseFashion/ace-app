-- ============================================================
-- Sales Person spelling fix: HARRIS → HARIES (as on his profile).
--  • renames the name in the Sales Person list and links it to his
--    ACE account (the profile whose name starts with "Haries")
--  • changes HARRIS → HARIES on existing projects, quotations and
--    saved New Project drafts, so his projects show on his My Projects
-- Safe to run more than once.
-- ============================================================

-- 1) the Sales Person list
insert into public.sales_people (name) values ('HARIES') on conflict (name) do nothing;
delete from public.sales_people where name = 'HARRIS';
update public.sales_people
   set user_id = (select id from public.profiles where full_name ilike 'haries%' order by full_name limit 1)
 where name = 'HARIES' and user_id is null;

-- 2) existing projects (his account is linked automatically when saved)
update public.projects set sales_person = 'HARIES' where upper(trim(sales_person)) = 'HARRIS';

-- 3) quotations and saved drafts
update public.quotation_docs set sales_person = 'HARIES' where upper(trim(sales_person)) = 'HARRIS';
update public.project_drafts
   set data = jsonb_set(data, '{project,sales_person}', '"HARIES"')
 where upper(trim(data #>> '{project,sales_person}')) = 'HARRIS';

-- Check: HARIES should show his name, and no project should still say HARRIS
select sp.name as sales_person, coalesce(p.full_name, '— not linked —') as ace_account,
       (select count(*) from public.projects where sales_person = 'HARIES') as his_projects,
       (select count(*) from public.projects where upper(trim(sales_person)) = 'HARRIS') as still_harris
from public.sales_people sp left join public.profiles p on p.id = sp.user_id
where sp.name = 'HARIES';
