-- Multi-user Supabase Auth + Row Level Security foundation.
-- Run this in Supabase SQL Editor after backing up production data.
-- Existing rows need a one-time backfill to the correct auth.users.id before
-- RLS is enabled for real multi-user operation.

create table if not exists users_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  initial_balance numeric not null default 0,
  monthly_income numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  closing_day text not null,
  payment_day text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_pattern text not null,
  category text not null,
  payment_method text,
  confidence numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_type text not null,
  broker text not null,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolio_id uuid references portfolios(id) on delete cascade,
  ticker text not null,
  name text not null,
  market text not null,
  sector text,
  quantity numeric not null default 0,
  avg_cost numeric not null default 0,
  current_price numeric not null default 0,
  currency text not null,
  day_change_rate numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transactions_stock (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  holding_id uuid references holdings(id) on delete cascade,
  type text not null check (type in ('buy', 'sell')),
  quantity numeric not null,
  price numeric not null,
  currency text not null,
  transaction_date date not null,
  realized_pnl numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  name text not null,
  market text not null,
  sector text,
  added_date date not null default current_date,
  added_price numeric not null default 0,
  current_price numeric not null default 0,
  currency text not null,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists news_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  source text not null,
  ticker_tags text[] not null default '{}',
  related_tickers text[] not null default '{}',
  headline text not null,
  url text not null,
  published_at timestamptz not null,
  importance_score integer not null default 0,
  category text not null check (category in ('company', 'macro')),
  audience text not null default 'holding',
  created_at timestamptz not null default now()
);

create table if not exists earnings_calendar (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  name text not null,
  announce_date date not null,
  timing text not null,
  eps_estimate numeric,
  revenue_estimate text,
  created_at timestamptz not null default now()
);

create table if not exists fx_rates (
  id uuid primary key default gen_random_uuid(),
  pair text not null unique,
  rate numeric not null,
  updated_at timestamptz not null default now()
);

do $$
declare
  tbl text;
  user_tables text[] := array[
    'users_profile',
    'transactions',
    'scheduled_payments',
    'account_balance',
    'stock_holdings',
    'credit_cards',
    'merchant_rules',
    'portfolios',
    'holdings',
    'transactions_stock',
    'watchlist',
    'news_items',
    'earnings_calendar'
  ];
begin
  foreach tbl in array user_tables loop
    if to_regclass('public.' || tbl) is not null and tbl <> 'users_profile' then
      execute format('alter table public.%I add column if not exists user_id uuid references auth.users(id) on delete cascade', tbl);
    end if;

    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);

      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tbl and policyname = 'select_own') then
        execute format('create policy select_own on public.%I for select using (auth.uid() = user_id)', tbl);
      end if;
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tbl and policyname = 'insert_own') then
        execute format('create policy insert_own on public.%I for insert with check (auth.uid() = user_id)', tbl);
      end if;
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tbl and policyname = 'update_own') then
        execute format('create policy update_own on public.%I for update using (auth.uid() = user_id)', tbl);
      end if;
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tbl and policyname = 'delete_own') then
        execute format('create policy delete_own on public.%I for delete using (auth.uid() = user_id)', tbl);
      end if;
    end if;
  end loop;
end $$;

alter table fx_rates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fx_rates' and policyname = 'read_all') then
    create policy read_all on fx_rates for select using (true);
  end if;
end $$;
