-- ============================================================
-- Quotations: optional "General Notes" (points, like the terms),
-- printed under Terms & Conditions only when a quotation has some.
-- Safe to run more than once.
-- ============================================================
alter table public.quotation_docs add column if not exists notes jsonb not null default '[]'::jsonb;
do $$ begin
  alter table public.quotation_docs add constraint quotation_docs_notes_array check (jsonb_typeof(notes) = 'array');
exception when duplicate_object then null; end $$;

-- Shows it's ready (should say: yes):
select case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quotation_docs' and column_name = 'notes') then 'yes' else 'no' end as general_notes_ready;
