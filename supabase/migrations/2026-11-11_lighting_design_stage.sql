-- ============================================================
-- New first project stage: "Lighting Design" (5%), before Tender.
--   Lighting Design 5% · Tender 10% · Job In Hand 20% · … ·
--   O & M Manual / Warranty Certificate 100%
-- Changing an existing project's status to or from Lighting Design
-- updates its progress automatically (as for every stage).
-- Safe to run more than once.
-- ============================================================

-- 1) allow the new stage (replace the allowed-values rule)
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.projects'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.projects drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.projects add constraint projects_status_check check (status in (
  'lighting_design',
  'tender',
  'job_in_hand',
  'letter_of_intent',
  'submittal',
  'samples_comments',
  'approval_code_b',
  'lpo_order_confirmation',
  'delivery',
  'invoice_payment',
  'om_manual_warranty'
));

-- 2) progress for each stage (Lighting Design = 5%)
create or replace function public.project_progress(p_status text)
returns int
language sql
immutable
as $$
  select case p_status
    when 'lighting_design' then 5
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

-- 3) keep every project's progress in line (nothing changes for existing stages)
update public.projects
   set percent_complete = public.project_progress(status)
 where percent_complete is distinct from public.project_progress(status);

-- Shows it's ready (should say 5):
select public.project_progress('lighting_design') as lighting_design_percent;
