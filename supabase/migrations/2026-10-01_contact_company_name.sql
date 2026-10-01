-- Company name on every contact (contractor, client, consultant,
-- main contractor). Safe to run more than once.
alter table public.contacts add column if not exists company_name text;
