-- ============================================================
-- "Supported By": people who support a salesperson's project.
--  • project_supporters: which people support which project.
--    Whoever can open the project (its creator, or management)
--    chooses the supporters.
--  • A supporter does NOT get access to the project itself. On the
--    Support page they only see Date, Quotation No, Sales Person and
--    Project Name (via my_support_projects()), and can add notes.
--  • support_notes: the supporters' notes on a project. Permanent
--    (no edit/delete). Seen by the project's supporters and by
--    whoever can open the project (salesperson, management).
-- Safe to run more than once.
-- ============================================================
create table if not exists public.project_supporters (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_supporters_user_idx on public.project_supporters (user_id);

create table if not exists public.support_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists support_notes_project_idx on public.support_notes (project_id, created_at desc);

-- is the signed-in person a supporter of this project? (no RLS loops)
create or replace function public.is_project_supporter(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_supporters where project_id = pid and user_id = auth.uid());
$$;

alter table public.project_supporters enable row level security;
drop policy if exists "see supporters" on public.project_supporters;
create policy "see supporters" on public.project_supporters for select
  using (user_id = auth.uid() or exists (select 1 from public.projects p where p.id = project_id));
drop policy if exists "project owners add supporters" on public.project_supporters;
create policy "project owners add supporters" on public.project_supporters for insert
  with check (exists (select 1 from public.projects p where p.id = project_id));
drop policy if exists "project owners remove supporters" on public.project_supporters;
create policy "project owners remove supporters" on public.project_supporters for delete
  using (exists (select 1 from public.projects p where p.id = project_id));

alter table public.support_notes enable row level security;
drop policy if exists "see support notes" on public.support_notes;
create policy "see support notes" on public.support_notes for select
  using (public.is_project_supporter(project_id) or exists (select 1 from public.projects p where p.id = project_id));
drop policy if exists "supporters add notes" on public.support_notes;
create policy "supporters add notes" on public.support_notes for insert
  with check (author_id = auth.uid() and public.is_project_supporter(project_id));
-- (no update/delete policies: notes are permanent)

-- The ONLY project details a supporter gets: date, quotation no,
-- sales person, project name.
create or replace function public.my_support_projects()
returns table (project_id uuid, project_date date, quotation_number text, sales_person text, project_name text, assigned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id,
         coalesce(q.quotation_date, p.created_at::date),
         q.quotation_number,
         p.sales_person,
         p.name,
         s.created_at
  from project_supporters s
  join projects p on p.id = s.project_id
  left join lateral (
    select quotation_date, quotation_number from quotations
    where project_id = p.id
    order by quotation_date desc nulls last, created_at desc
    limit 1
  ) q on true
  where s.user_id = auth.uid()
  order by coalesce(q.quotation_date, p.created_at::date) desc;
$$;
revoke all on function public.my_support_projects() from public, anon;
grant execute on function public.my_support_projects() to authenticated;

-- live updates
do $$ begin alter publication supabase_realtime add table public.support_notes; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.project_supporters; exception when others then null; end $$;
