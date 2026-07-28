-- ============================================================
-- ACE database schema
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
-- ============================================================

-- 1. PROFILES (extends Supabase's built-in auth.users with a role + name)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  role text not null default 'employee' check (role in ('admin','manager','employee','client','contractor')),
  created_at timestamptz default now()
);

-- automatically create a profile row whenever someone signs up
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

-- 2. PROJECTS
create table projects (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  status text not null default 'design' check (status in ('design','tender','job_in_hand')),
  location text,
  brands_required text,
  percent_complete int default 10,
  created_by uuid references profiles(id),
  owner_id uuid references profiles(id), -- the client/contractor this project belongs to, if any
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. CONTACTS (business card details, multiple per project per role)
create table contacts (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  contact_role text not null check (contact_role in ('contractor','client','consultant','main_contractor')),
  name text,
  designation text,
  tel text,
  mobile text,
  email text,
  created_at timestamptz default now()
);

-- 4. QUOTATIONS
create table quotations (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  quotation_number text,
  quotation_date date,
  target_submission_date date,
  brands_offered text,
  quotation_value numeric,
  created_at timestamptz default now()
);

-- 5. MEETINGS
create table meetings (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade,
  meeting_date date,
  venue text,
  notes text,
  actions text,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW-LEVEL SECURITY
-- This is what actually keeps clients/contractors locked to
-- only their own data -- enforced by the database itself,
-- not just hidden in the UI.
-- ============================================================

alter table profiles enable row level security;
alter table projects enable row level security;
alter table contacts enable row level security;
alter table quotations enable row level security;
alter table meetings enable row level security;

-- helper: get the current user's role
create function my_role()
returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;

-- PROFILES: everyone can see their own profile; staff can see all
create policy "view own profile" on profiles for select
  using (id = auth.uid() or my_role() in ('admin','manager','employee'));

-- PROJECTS: staff see everything; clients/contractors see only projects they own
create policy "staff full access to projects" on projects for all
  using (my_role() in ('admin','manager','employee'));

create policy "external users see own projects" on projects for select
  using (owner_id = auth.uid());

-- CONTACTS / QUOTATIONS / MEETINGS: staff see everything;
-- external users see rows tied to their own project
create policy "staff full access to contacts" on contacts for all
  using (my_role() in ('admin','manager','employee'));
create policy "external users view own project contacts" on contacts for select
  using (project_id in (select id from projects where owner_id = auth.uid()));

create policy "staff full access to quotations" on quotations for all
  using (my_role() in ('admin','manager','employee'));
create policy "external users view own project quotations" on quotations for select
  using (project_id in (select id from projects where owner_id = auth.uid()));

create policy "staff full access to meetings" on meetings for all
  using (my_role() in ('admin','manager','employee'));
create policy "external users view own project meetings" on meetings for select
  using (project_id in (select id from projects where owner_id = auth.uid()));
