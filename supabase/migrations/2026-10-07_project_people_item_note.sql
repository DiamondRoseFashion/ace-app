-- ============================================================
-- Project details: Sales Person, Headed By, Lead By, Item, Note
-- Existing quotation "Issued By", "Item" and "Remarks" values are
-- copied onto their project so nothing is lost.
-- Safe to run more than once.
-- ============================================================
alter table public.projects add column if not exists sales_person text;
alter table public.projects add column if not exists headed_by text;
alter table public.projects add column if not exists lead_by text;
alter table public.projects add column if not exists item text;
alter table public.projects add column if not exists note text;

-- copy from each project's most recent quotation that has a value
update public.projects p set sales_person = q.v
  from (select distinct on (project_id) project_id, nullif(trim(issued_by), '') as v
          from public.quotations where nullif(trim(issued_by), '') is not null
         order by project_id, created_at desc) q
 where q.project_id = p.id and p.sales_person is null;

update public.projects p set item = q.v
  from (select distinct on (project_id) project_id, nullif(trim(item), '') as v
          from public.quotations where nullif(trim(item), '') is not null
         order by project_id, created_at desc) q
 where q.project_id = p.id and p.item is null;

update public.projects p set note = q.v
  from (select distinct on (project_id) project_id, nullif(trim(remarks), '') as v
          from public.quotations where nullif(trim(remarks), '') is not null
         order by project_id, created_at desc) q
 where q.project_id = p.id and p.note is null;
