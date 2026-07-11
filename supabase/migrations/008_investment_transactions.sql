-- Investment transaction history imported from Rakuten Securities tradehistory CSV.

create table if not exists investment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_type text not null check (asset_type in ('stock', 'fund')),
  symbol text,
  name text not null,
  account_type text,
  trade_type text not null,
  trade_date date not null,
  settlement_date date,
  quantity numeric not null default 0,
  unit_price numeric not null default 0,
  amount_jpy numeric not null default 0,
  amount_foreign numeric,
  currency text not null default 'JPY',
  fx_rate numeric,
  source text not null default 'rakuten_csv',
  external_id text not null,
  created_at timestamptz not null default now()
);

alter table investment_transactions enable row level security;

drop policy if exists select_own on investment_transactions;
drop policy if exists insert_own on investment_transactions;
drop policy if exists update_own on investment_transactions;
drop policy if exists delete_own on investment_transactions;

create policy select_own on investment_transactions
  for select
  using (auth.uid() = user_id);

create policy insert_own on investment_transactions
  for insert
  with check (auth.uid() = user_id);

create policy update_own on investment_transactions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy delete_own on investment_transactions
  for delete
  using (auth.uid() = user_id);

create unique index if not exists investment_transactions_user_external_id_idx
  on investment_transactions (user_id, external_id);

create index if not exists investment_transactions_user_date_idx
  on investment_transactions (user_id, trade_date desc);

grant select, insert, update, delete on investment_transactions to authenticated;
grant all on investment_transactions to service_role;
