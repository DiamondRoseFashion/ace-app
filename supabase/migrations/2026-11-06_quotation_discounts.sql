-- ============================================================
-- Quotations: show the costing sheet's selling special discounts
-- (Total → Special Discount → Total after Discount → VAT → Net Total).
-- They come in with "Update from costing sheet", like the items.
-- Safe to run more than once.
-- ============================================================
alter table public.quotation_docs add column if not exists discounts jsonb not null default '[]'::jsonb;
do $$ begin
  alter table public.quotation_docs add constraint quotation_docs_discounts_array check (jsonb_typeof(discounts) = 'array');
exception when duplicate_object then null; end $$;

-- Shows the new column is ready:
select count(*) as quotations, count(*) filter (where jsonb_typeof(discounts) = 'array') as with_discounts_column from public.quotation_docs;
