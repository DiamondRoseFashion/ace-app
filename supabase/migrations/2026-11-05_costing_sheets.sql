-- ============================================================
-- Costing sheets (project page → "Costing sheets").
--  • costing_sheets: one sheet per project revision (R0, R1 …).
--    The top details (project, client, contractor, consultant,
--    quotation no. and date) and every item row are kept on it.
--  • costing_options: the shared dropdown lists (Make, Model, Code,
--    Make (OEM), OEM Code). A value one person adds shows for all.
--  • costing_products: what ACE remembers per Code + Description
--    (the Mfctr's offer price and currency, and the product image),
--    so it fills in by itself next time. One code can have several
--    descriptions.
--  • currency_rates: AED value of 1 unit of each currency (admin edits).
--  • Storage bucket "costing-images" for the pasted product images.
-- ACCESS: only Admin for now. To open it to more people later, only
-- has_costing_access() below needs changing.
-- Safe to run more than once.
-- ============================================================

create or replace function public.has_costing_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false);
$$;
revoke all on function public.has_costing_access() from public, anon;
grant execute on function public.has_costing_access() to authenticated;

-- ---------- sheets ----------
create table if not exists public.costing_sheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  revision text not null default 'R0' check (length(revision) between 1 and 20),
  project_name text,
  client text,
  contractor text,
  consultant text,
  quotation_no text,
  quotation_date date,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  discounts_buy jsonb not null default '[]'::jsonb check (jsonb_typeof(discounts_buy) = 'array'),
  discounts_sell jsonb not null default '[]'::jsonb check (jsonb_typeof(discounts_sell) = 'array'),
  note text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists costing_sheets_project_idx on public.costing_sheets (project_id, created_at);

alter table public.costing_sheets enable row level security;
drop policy if exists "costing access" on public.costing_sheets;
create policy "costing access" on public.costing_sheets for all
  using (public.has_costing_access())
  with check (public.has_costing_access());

create or replace function public.costing_sheets_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.project_id := old.project_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists costing_sheets_guard on public.costing_sheets;
create trigger costing_sheets_guard before insert or update on public.costing_sheets
  for each row execute function public.costing_sheets_guard();

-- ---------- shared dropdown lists ----------
create table if not exists public.costing_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('make', 'model', 'code', 'make_oem', 'oem_code')),
  value text not null check (length(trim(value)) between 1 and 200),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists costing_options_unique on public.costing_options (kind, lower(trim(value)));

alter table public.costing_options enable row level security;
drop policy if exists "costing access" on public.costing_options;
create policy "costing access" on public.costing_options for all
  using (public.has_costing_access())
  with check (public.has_costing_access());

-- ---------- remembered products (code + description) ----------
create table if not exists public.costing_products (
  id uuid primary key default gen_random_uuid(),
  code text not null check (length(trim(code)) between 1 and 200),
  description text not null check (length(trim(description)) between 1 and 2000),
  offer_price numeric,
  offer_currency text,
  image_path text,
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists costing_products_unique on public.costing_products (lower(trim(code)), lower(trim(description)));

alter table public.costing_products enable row level security;
drop policy if exists "costing access" on public.costing_products;
create policy "costing access" on public.costing_products for all
  using (public.has_costing_access())
  with check (public.has_costing_access());

-- ---------- currency rates (AED for 1 unit) ----------
create table if not exists public.currency_rates (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  rate numeric not null check (rate > 0),
  updated_at timestamptz not null default now()
);
insert into public.currency_rates (code, rate) values
  ('AED', 1), ('USD', 3.68), ('EUR', 4.00), ('GBP', 4.70), ('CNY', 0.51), ('INR', 0.044), ('SAR', 0.98)
on conflict (code) do nothing;

alter table public.currency_rates enable row level security;
drop policy if exists "costing access" on public.currency_rates;
create policy "costing access" on public.currency_rates for all
  using (public.has_costing_access())
  with check (public.has_costing_access());

-- ---------- learn from a saved sheet ----------
-- Adds new dropdown values, and remembers each Code + Description's
-- offer price / currency / image (the latest saved wins; an empty
-- price or image never wipes a remembered one).
create or replace function public.costing_learn(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  k text;
  v text;
  c text;
  d text;
  price numeric;
begin
  if not public.has_costing_access() then
    raise exception 'No access to costing sheets';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    foreach k in array array['make', 'model', 'code', 'make_oem', 'oem_code'] loop
      v := nullif(trim(it ->> k), '');
      if v is not null and length(v) <= 200 then
        insert into costing_options (kind, value) values (k, v)
        on conflict (kind, lower(trim(value))) do nothing;
      end if;
    end loop;

    c := nullif(trim(it ->> 'code'), '');
    d := nullif(trim(it ->> 'description'), '');
    if c is not null and d is not null and length(c) <= 200 and length(d) <= 2000 then
      price := case when (it ->> 'offer_price') ~ '^-?[0-9]+(\.[0-9]+)?$' then (it ->> 'offer_price')::numeric end;
      insert into costing_products (code, description, offer_price, offer_currency, image_path)
      values (c, d, price, nullif(it ->> 'offer_currency', ''), nullif(it ->> 'image_path', ''))
      on conflict (lower(trim(code)), lower(trim(description))) do update set
        offer_price = coalesce(excluded.offer_price, costing_products.offer_price),
        offer_currency = case when excluded.offer_price is not null
                              then coalesce(excluded.offer_currency, costing_products.offer_currency)
                              else costing_products.offer_currency end,
        image_path = coalesce(excluded.image_path, costing_products.image_path),
        updated_by = auth.uid(),
        updated_at = now();
    end if;
  end loop;
end;
$$;
revoke all on function public.costing_learn(jsonb) from public, anon;
grant execute on function public.costing_learn(jsonb) to authenticated;

-- ---------- product images ----------
insert into storage.buckets (id, name, public)
values ('costing-images', 'costing-images', false)
on conflict (id) do nothing;

drop policy if exists "costing images access" on storage.objects;
create policy "costing images access" on storage.objects for all
  using (bucket_id = 'costing-images' and public.has_costing_access())
  with check (bucket_id = 'costing-images' and public.has_costing_access());

-- Shows everything is ready (you should see 7 currencies and 0 sheets):
select (select count(*) from public.currency_rates) as currencies,
       (select count(*) from public.costing_sheets) as sheets;
