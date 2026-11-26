-- ============================================================
-- Costing sheet: product list ("Create an item")
--  One row per Code. Each code has ONE Model, Type, Housing,
--  Diffuser and Image, and LISTS of choices (variations) for
--  Wattage, Lumen, Dimension, CCT and IP.
--  Picking a code on a costing sheet opens a pop-up: choose one of
--  each list, press OK → Model, Description and Image fill in.
--  Same access as costing sheets (admin + costing_access people).
-- Safe to run more than once.
-- ============================================================
create table if not exists public.costing_items (
  id uuid primary key default gen_random_uuid(),
  code text not null check (length(trim(code)) between 1 and 200),
  model text,
  item_type text,
  housing text,
  diffuser text,
  image_path text,
  wattages text[] not null default '{}',
  lumens text[] not null default '{}',
  dimensions text[] not null default '{}',
  ccts text[] not null default '{}',
  ips text[] not null default '{}',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists costing_items_code_unique on public.costing_items (lower(trim(code)));

alter table public.costing_items enable row level security;
drop policy if exists "costing access" on public.costing_items;
create policy "costing access" on public.costing_items for all
  using (public.has_costing_access())
  with check (public.has_costing_access());

-- Shows it's ready (0 items the first time)
select count(*) as items_in_product_list from public.costing_items;
