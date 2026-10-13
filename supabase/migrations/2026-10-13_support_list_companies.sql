-- ============================================================
-- Support page: also show the Contractor, Client and Consultant
-- (company names only: no people, phones or emails) of each
-- project a person supports.
-- Safe to run more than once.
-- ============================================================
drop function if exists public.my_support_projects();
create function public.my_support_projects()
returns table (project_id uuid, project_date date, quotation_number text, sales_person text, project_name text,
               contractor text, client text, consultant text, assigned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id,
         coalesce(q.quotation_date, p.created_at::date),
         q.quotation_number,
         p.sales_person,
         p.name,
         (select string_agg(distinct coalesce(nullif(trim(c.company_name), ''), trim(c.name)), ' | ')
            from contacts c where c.project_id = p.id and c.contact_role = 'contractor'),
         (select string_agg(distinct coalesce(nullif(trim(c.company_name), ''), trim(c.name)), ' | ')
            from contacts c where c.project_id = p.id and c.contact_role = 'client'),
         (select string_agg(distinct coalesce(nullif(trim(c.company_name), ''), trim(c.name)), ' | ')
            from contacts c where c.project_id = p.id and c.contact_role = 'consultant'),
         s.created_at
  from project_supporters s
  join projects p on p.id = s.project_id
  left join lateral (
    select quotation_date, quotation_number from quotations
    where project_id = p.id
    order by quotation_date desc nulls last, created_at desc
    limit 1
  ) q on true
  where s.user_id = auth.uid()
  order by coalesce(q.quotation_date, p.created_at::date) desc;
$$;
revoke all on function public.my_support_projects() from public, anon;
grant execute on function public.my_support_projects() to authenticated;
