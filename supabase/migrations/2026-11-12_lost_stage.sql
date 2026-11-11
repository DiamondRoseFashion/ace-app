-- ============================================================
-- New project status "Lost" (0%), last in the list.
--   Lighting Design 5% · Tender 10% · … · O & M Manual / Warranty
--   Certificate 100% · Lost 0%
-- Any project (old or new) can be set to Lost; its progress becomes 0%.
-- Safe to run more than once.
-- ============================================================

-- 1) allow the new status (replace the allowed-values rule)
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
  'om_manual_warranty',
  'lost'
));

-- 2) progress for each status (Lost = 0%)
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
    when 'lost' then 0
    else 10
  end;
$$;

-- Shows it's ready (should say 0):
select public.project_progress('lost') as lost_percent;
