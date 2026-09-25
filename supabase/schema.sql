-- ============================================================
-- ACE database schema — snapshot of the LIVE Supabase project
-- (project ref: ljthoasdnvpldbvtuveg), taken 2026-09-25.
--
-- The original V1 schema was changed directly in the Supabase
-- SQL editor over time (owner role, expenses, quotation register
-- fields, profile fields, tightened employee access). This file
-- was rebuilt from the live database's catalog so the repo
-- matches reality. Future changes go in supabase/migrations/.
--
-- To recreate the database from scratch: run this whole file in
-- Supabase -> SQL Editor, then create the three storage buckets
-- listed at the bottom.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES (extends auth.users)
-- ------------------------------------------------------------
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  role text not null default 'employee'
    check (role in ('owner','admin','manager','employee')),
  created_at timestamptz default now(),
  avatar_url text,
  phone text,
  designation text
);

-- every new auth user gets a profile row as an employee
create function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'employee');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- helper: current user's role
create function my_role()
returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;

-- used on first login so a new member can set their own name
create function update_my_name(new_name text)
returns void as $$
begin
  update profiles set full_name = new_name where id = auth.uid();
end;
$$ language plpgsql security definer;

-- ------------------------------------------------------------
-- 2. PROJECTS (also carries the quotation-register fields that
--    were merged into the projects sheet)
-- ------------------------------------------------------------
create table projects (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  status text not null default 'design'
    check (status in ('design','tender','job_in_hand')),
  location text,
  brands_required text,
  percent_complete int default 10,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  quotation_no text,
  quotation_status text,
  win_percentage numeric,
  issued_by text,
  opportunity_ref text,
  customer_name text,
  client text,
  consultant text,
  value numeric,
  item text,
  remarks text,
  quotation_date date,
  contractor text
);

-- ------------------------------------------------------------
-- 3. CONTACTS (multiple per project per role)
-- ------------------------------------------------------------
create table contacts (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  contact_role text not null
    check (contact_role in ('contractor','client','consultant','main_contractor')),
  name text,
  designation text,
  tel text,
  mobile text,
  email text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 4. QUOTATIONS
-- ------------------------------------------------------------
create table quotations (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  quotation_number text,
  quotation_date date,
  target_submission_date date,
  brands_offered text,
  quotation_value numeric,
  created_at timestamptz default now(),
  quotation_status text,
  win_percentage numeric,
  issued_by text,
  opportunity_ref text,
  customer_name text,
  client text,
  consultant text,
  item text,
  remarks text,
  contractor text
);

-- ------------------------------------------------------------
-- 5. MEETINGS
-- ------------------------------------------------------------
create table meetings (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  meeting_date date,
  venue text,
  notes text,
  actions text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 6. EXPENSES
-- ------------------------------------------------------------
create table expenses (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid references profiles(id),
  amount numeric,
  expense_date date,
  category text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ============================================================
-- ROW-LEVEL SECURITY (enforced by the database itself)
-- Management = owner / admin / manager: see and edit everything.
-- Employees: only projects they created (and that project's
-- contacts, quotations, meetings) and only their own expenses.
-- ============================================================
alter table profiles   enable row level security;
alter table projects   enable row level security;
alter table contacts   enable row level security;
alter table quotations enable row level security;
alter table meetings   enable row level security;
alter table expenses   enable row level security;

-- PROFILES
create policy "view own profile" on profiles for select
  using (id = auth.uid() or my_role() in ('admin','manager','employee'));
create policy "staff manage profiles" on profiles for update
  using (my_role() in ('admin','manager'))
  with check (my_role() in ('admin','manager'));

-- PROJECTS
create policy "employees manage own projects" on projects for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());
create policy "management full access to projects" on projects for all
  using (exists (select 1 from profiles where profiles.id = auth.uid()
                 and profiles.role in ('owner','admin','manager')))
  with check (exists (select 1 from profiles where profiles.id = auth.uid()
                 and profiles.role in ('owner','admin','manager')));

-- CONTACTS
create policy "employees manage own project contacts" on contacts for all
  using (exists (select 1 from projects where projects.id = contacts.project_id
                 and projects.created_by = auth.uid()))
  with check (exists (select 1 from projects where projects.id = contacts.project_id
                 and projects.created_by = auth.uid()));
create policy "management full access to contacts" on contacts for all
  using (exists (select 1 from profiles where profiles.id = auth.uid()
                 and profiles.role in ('owner','admin','manager')))
  with check (exists (select 1 from profiles where profiles.id = auth.uid()
                 and profiles.role in ('owner','admin','manager')));

-- QUOTATIONS
create policy "employees manage own project quotations" on quotations for all
  using (exists (select 1 from projects where projects.id = quotations.project_id
                 and projects.created_by = auth.uid()))
  with check (exists (select 1 from projects where projects.id = quotations.project_id
                 and projects.created_by = auth.uid()));
create policy "management full access to quotations" on quotations for all
  using (exists (select 1 from profiles where profiles.id = auth.uid()
                 and profiles.role in ('owner','admin','manager')))
  with check (exists (select 1 from profiles where profiles.id = auth.uid()
                 and profiles.role in ('owner','admin','manager')));

-- MEETINGS
create policy "employees manage own project meetings" on meetings for all
  using (exists (select 1 from projects where projects.id = meetings.project_id
                 and projects.created_by = auth.uid()))
  with check (exists (select 1 from projects where projects.id = meetings.project_id
                 and projects.created_by = auth.uid()));
create policy "management full access to meetings" on meetings for all
  using (exists (select 1 from profiles where profiles.id = auth.uid()
                 and profiles.role in ('owner','admin','manager')))
  with check (exists (select 1 from profiles where profiles.id = auth.uid()
                 and profiles.role in ('owner','admin','manager')));

-- EXPENSES
create policy "employees add own expenses" on expenses for insert
  with check (employee_id = auth.uid());
create policy "employees view own expenses" on expenses for select
  using (employee_id = auth.uid());
create policy "staff manage expenses" on expenses for all
  using (exists (select 1 from profiles where profiles.id = auth.uid()
                 and profiles.role in ('owner','admin','manager')))
  with check (exists (select 1 from profiles where profiles.id = auth.uid()
                 and profiles.role in ('owner','admin','manager')));

-- ============================================================
-- STORAGE
-- Buckets (create in Supabase -> Storage):
--   project-files  (private)  per-project uploads
--   backups        (private)  rolling Excel backup, written server-side
--   avatars        (public)   profile pictures, path = <user id>/avatar.<ext>
-- ============================================================
create policy "staff manage project files" on storage.objects for all
  using (bucket_id = 'project-files'
         and my_role() in ('admin','manager','employee'));

create policy "Anyone can view avatars" on storage.objects for select
  using (bucket_id = 'avatars');
create policy "Users can upload their own avatar" on storage.objects for insert
  with check (bucket_id = 'avatars'
              and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users can update their own avatar" on storage.objects for update
  using (bucket_id = 'avatars'
         and auth.uid()::text = (storage.foldername(name))[1]);
