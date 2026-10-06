-- ============================================================
-- New project stages (replaces Design / Tender / Job in Hand)
-- Projects that were "Design" become "Tender".
-- Safe to run more than once.
-- ============================================================

-- remove the old allowed-values rule, whatever it was named
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

update public.projects set status = 'tender' where status = 'design' or status is null;

alter table public.projects alter column status set default 'tender';

alter table public.projects add constraint projects_status_check check (status in (
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
