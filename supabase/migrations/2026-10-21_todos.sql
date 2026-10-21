-- ============================================================
-- To-Do list (sidebar "To-Do").
--  • todo_access: who may use To-Do. Only people listed here see
--    it. Nobody can add themselves from the app: access is given
--    only from this SQL editor.
--  • todos: a task with title, note, due date, priority, the
--    person it's assigned to and (optionally) a linked project.
--    You see to-dos you created or that are assigned to you.
--    Marking one done hides it from the list (kept for history).
-- Safe to run more than once.
-- ============================================================
create table if not exists public.todo_access (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table public.todo_access enable row level security;
drop policy if exists "see todo access" on public.todo_access;
create policy "see todo access" on public.todo_access for select using (auth.uid() is not null);
-- (no insert/update/delete policies: only the SQL editor can change access)

create or replace function public.has_todo_access(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from todo_access where user_id = uid);
$$;
revoke all on function public.has_todo_access(uuid) from public, anon;
grant execute on function public.has_todo_access(uuid) to authenticated;

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 300),
  note text check (note is null or length(note) <= 4000),
  due_date date,
  priority text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  assigned_to uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null
);
create index if not exists todos_assigned_idx on public.todos (assigned_to) where done_at is null;
create index if not exists todos_created_idx on public.todos (created_by) where done_at is null;

alter table public.todos enable row level security;
drop policy if exists "see my todos" on public.todos;
create policy "see my todos" on public.todos for select
  using (public.has_todo_access() and (assigned_to = auth.uid() or created_by = auth.uid()));
drop policy if exists "add todos" on public.todos;
create policy "add todos" on public.todos for insert
  with check (public.has_todo_access() and created_by = auth.uid() and public.has_todo_access(assigned_to));
drop policy if exists "edit my todos" on public.todos;
create policy "edit my todos" on public.todos for update
  using (public.has_todo_access() and (assigned_to = auth.uid() or created_by = auth.uid()))
  with check (public.has_todo_access(assigned_to));
drop policy if exists "delete todos I made" on public.todos;
create policy "delete todos I made" on public.todos for delete
  using (public.has_todo_access() and created_by = auth.uid());

-- creator can't be changed; record who marked it done
create or replace function public.todos_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.done_at is not null and old.done_at is null then
    new.done_by := auth.uid();
  elsif new.done_at is null then
    new.done_by := null;
  end if;
  return new;
end;
$$;
drop trigger if exists todos_guard on public.todos;
create trigger todos_guard before update on public.todos
  for each row execute function public.todos_guard();

-- First access: Amal's admin account only.
insert into public.todo_access (user_id)
select id from public.profiles where role = 'admin' and full_name ilike '%amal%'
on conflict do nothing;

-- Shows who has To-Do access now:
select p.full_name, p.role from public.todo_access a join public.profiles p on p.id = a.user_id;
