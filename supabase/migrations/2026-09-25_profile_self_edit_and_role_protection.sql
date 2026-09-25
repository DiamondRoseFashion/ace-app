-- ============================================================
-- Fix 1: let every user save their OWN profile (name, phone,
--        job title, photo). Before this, only admin/manager had
--        an update rule, so employees' saves silently did nothing.
-- Fix 2: protect the role column. Nobody can raise their own
--        role. Managers may still switch OTHER people between
--        employee and manager; only admin/owner can grant or
--        remove admin/owner.
-- Safe to run more than once.
-- ============================================================

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.protect_role_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  -- role not being changed: nothing to check
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- changes made from the Supabase dashboard / server have no
  -- logged-in app user; allow them
  if auth.uid() is null then
    return new;
  end if;

  actor_role := public.my_role();

  if actor_role in ('owner', 'admin') then
    return new;
  end if;

  if actor_role = 'manager'
     and new.id <> auth.uid()
     and old.role in ('manager', 'employee')
     and new.role in ('manager', 'employee') then
    return new;
  end if;

  raise exception 'You are not allowed to make this role change';
end;
$$;

drop trigger if exists protect_role_changes on public.profiles;
create trigger protect_role_changes
  before update on public.profiles
  for each row execute function public.protect_role_changes();
