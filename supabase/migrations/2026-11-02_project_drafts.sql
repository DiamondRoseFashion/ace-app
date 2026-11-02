-- ============================================================
-- Project drafts ("Save as draft" on New Project).
--  • A draft keeps the half-filled New Project form (details,
--    contacts, Supported By) until you finish it.
--  • Only the person who made a draft can see, change or delete it.
--  • A draft is NOT a project: it isn't in project lists, reports,
--    Support, notifications or backups. When you press
--    "Save & Continue" it becomes a real project and the draft goes.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.project_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text check (name is null or length(name) <= 300),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_drafts_owner_idx on public.project_drafts (created_by, updated_at desc);

alter table public.project_drafts enable row level security;
drop policy if exists "my drafts only" on public.project_drafts;
create policy "my drafts only" on public.project_drafts for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- owner can't be changed; "last saved" is always the real time
create or replace function public.project_drafts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists project_drafts_guard on public.project_drafts;
create trigger project_drafts_guard before insert or update on public.project_drafts
  for each row execute function public.project_drafts_guard();

-- Shows the new table is ready (0 drafts at first):
select count(*) as drafts from public.project_drafts;
