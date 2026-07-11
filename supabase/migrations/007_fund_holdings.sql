-- Investment trust holdings.
-- Fund values are imported from brokerage CSV and stored separately from stocks
-- because funds use units/base price instead of shares/stock price.

create table if not exists fund_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_type text,
  units numeric not null default 0,
  average_cost numeric not null default 0,
  base_price numeric not null default 0,
  current_value numeric not null default 0,
  gain_loss numeric not null default 0,
  gain_loss_rate numeric,
  broker_snapshot_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table fund_holdings enable row level security;

drop policy if exists select_own on fund_holdings;
drop policy if exists insert_own on fund_holdings;
drop policy if exists update_own on fund_holdings;
drop policy if exists delete_own on fund_holdings;

create policy select_own on fund_holdings
  for select
  using (auth.uid() = user_id);

create policy insert_own on fund_holdings
  for insert
  with check (auth.uid() = user_id);

create policy update_own on fund_holdings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy delete_own on fund_holdings
  for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on fund_holdings to authenticated;
grant all on fund_holdings to service_role;

create unique index if not exists fund_holdings_user_name_account_idx
  on fund_holdings (user_id, name, coalesce(account_type, ''));
