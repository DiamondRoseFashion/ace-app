-- ============================================================
-- E-signatures (My Profile → E-signature, printed on quotations).
--  • profiles.signature_path: where the person's signature image is.
--  • Storage bucket "signatures" (private), path <user id>/<file>:
--      - only you can upload, replace or delete your own signature
--      - you, and people who make quotations (has_costing_access),
--        can read it (to print it on the quotation PDF)
-- Safe to run more than once.
-- ============================================================
alter table public.profiles add column if not exists signature_path text;

insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', false)
on conflict (id) do nothing;

drop policy if exists "read signatures" on storage.objects;
create policy "read signatures" on storage.objects for select
  using (bucket_id = 'signatures'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.has_costing_access()));

drop policy if exists "add own signature" on storage.objects;
create policy "add own signature" on storage.objects for insert
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "change own signature" on storage.objects;
create policy "change own signature" on storage.objects for update
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delete own signature" on storage.objects;
create policy "delete own signature" on storage.objects for delete
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

-- Shows it's ready (should say: yes):
select case when exists (select 1 from storage.buckets where id = 'signatures') then 'yes' else 'no' end as signatures_ready;
