-- ============================================================
-- Progress follows the project stage automatically
--   Tender 10% · Job In Hand 20% · Letter of Intent 30% ·
--   Submittal 40% · Samples & Comments 50% · Approval - Code B 60% ·
--   LPO / Order Confirmation 70% · Delivery 80% ·
--   Invoice & Payment 90% · O & M Manual / Warranty Certificate 100%
-- Also turns on live updates for projects, so dashboards refresh
-- the moment someone changes a status.
-- Safe to run more than once.
-- ============================================================

create or replace function public.project_progress(p_status text)
returns int
language sql
immutable
as $$
  select case p_status
    when 'tender' then 10
    when 'job_in_hand' then 20
    when 'letter_of_intent' then 30
    when 'submittal' then 40
    when 'samples_comments' then 50
    when 'approval_code_b' then 60
    when 'lpo_order_confirmation' then 70
    when 'delivery' then 80
    when 'invoice_payment' then 90
    when 'om_manual_warranty' then 100
    else 10
  end;
$$;

create or replace function public.set_project_progress()
returns trigger
language plpgsql
as $$
begin
  new.percent_complete := public.project_progress(new.status);
  return new;
end;
$$;

drop trigger if exists projects_progress_from_status on public.projects;
create trigger projects_progress_from_status
  before insert or update on public.projects
  for each row execute function public.set_project_progress();

-- bring every existing project in line
update public.projects
   set percent_complete = public.project_progress(status)
 where percent_complete is distinct from public.project_progress(status);

-- live updates
do $$
begin
  alter publication supabase_realtime add table public.projects;
exception when others then
  null; -- already added
end $$;
