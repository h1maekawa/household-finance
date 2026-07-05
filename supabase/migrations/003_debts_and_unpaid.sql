-- 貸し借り(debts)の管理と、固定費の「今サイクル分は支払い済みか」の記録。

create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('borrowed', 'lent')), -- borrowed=借りている, lent=貸している
  counterparty text not null,   -- 相手(誰から/誰に)
  amount numeric not null,
  date date not null default current_date,
  due_date date,
  memo text,
  is_settled boolean not null default false, -- 返済/回収済みか
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table debts enable row level security;

drop policy if exists select_own on debts;
drop policy if exists insert_own on debts;
drop policy if exists update_own on debts;
drop policy if exists delete_own on debts;
create policy select_own on debts for select using (auth.uid() = user_id);
create policy insert_own on debts for insert with check (auth.uid() = user_id);
create policy update_own on debts for update using (auth.uid() = user_id);
create policy delete_own on debts for delete using (auth.uid() = user_id);

grant all on debts to service_role;

-- 固定費(scheduled_payments)について、直近どの月まで支払い済みかを記録する。
-- 'YYYY-MM' 形式。nullの場合は一度も支払い済みにされていないことを意味する。
alter table scheduled_payments add column if not exists last_paid_month text;

-- 前回のマイグレーションでservice_roleへの基本権限(SELECT/INSERT/UPDATE/DELETE)が
-- 不足していたことがあったため、念のためここでも明示的に付与しておく。
grant all on scheduled_payments to service_role;
grant all on transactions to service_role;
grant all on account_balance to service_role;
grant all on stock_holdings to service_role;
