-- V2.1 基盤: 口座を第一級エンティティに昇格させる。
-- 「◯日の引き落としまでに、その口座へいくら残すべきか」を FK 1本で計算できるようにする。
-- 既存の bank_account(text) は当面残し、debit_account_id へ段階移行する。

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,                       -- '三井住友銀行' '楽天銀行'
  type text not null default 'bank' check (type in ('bank', 'emoney', 'cash', 'securities')),
  institution text,
  is_primary boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

-- 口座別の残高スナップショット(時系列)。金額は整数円で持つ。
create table if not exists account_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  balance integer not null,
  recorded_at timestamptz not null default now()
);

create index if not exists account_balances_account_recorded_idx
  on account_balances (account_id, recorded_at desc);

-- 引き落とし元口座を FK 化する(既存の text カラムは移行完了まで併存)
alter table credit_cards
  add column if not exists debit_account_id uuid references accounts(id) on delete set null;

alter table scheduled_payments
  add column if not exists debit_account_id uuid references accounts(id) on delete set null;

-- 現金・カード利用元の口座(nullable)。固定費の予定↔実績の手動突合用に
-- scheduled_payment_id も持たせる(docs/budget-design.md)。
alter table transactions
  add column if not exists account_id uuid references accounts(id) on delete set null,
  add column if not exists scheduled_payment_id uuid references scheduled_payments(id) on delete set null;

-- 集計の主軸。予算エンジン・コーチ・分析APIが全てここを叩く。
create index if not exists transactions_user_date_idx
  on transactions (user_id, date desc);
create index if not exists transactions_user_category_date_idx
  on transactions (user_id, category, date desc);

alter table accounts enable row level security;
alter table account_balances enable row level security;

-- create policy に if not exists は無いので、drop → create で再実行可能にする。
drop policy if exists "accounts_select_own" on accounts;
create policy "accounts_select_own" on accounts for select using (auth.uid() = user_id);
drop policy if exists "accounts_insert_own" on accounts;
create policy "accounts_insert_own" on accounts for insert with check (auth.uid() = user_id);
drop policy if exists "accounts_update_own" on accounts;
create policy "accounts_update_own" on accounts for update using (auth.uid() = user_id);
drop policy if exists "accounts_delete_own" on accounts;
create policy "accounts_delete_own" on accounts for delete using (auth.uid() = user_id);

drop policy if exists "account_balances_select_own" on account_balances;
create policy "account_balances_select_own" on account_balances for select using (auth.uid() = user_id);
drop policy if exists "account_balances_insert_own" on account_balances;
create policy "account_balances_insert_own" on account_balances for insert with check (auth.uid() = user_id);
drop policy if exists "account_balances_update_own" on account_balances;
create policy "account_balances_update_own" on account_balances for update using (auth.uid() = user_id);
drop policy if exists "account_balances_delete_own" on account_balances;
create policy "account_balances_delete_own" on account_balances for delete using (auth.uid() = user_id);

grant all on accounts to authenticated;
grant all on accounts to service_role;
grant all on account_balances to authenticated;
grant all on account_balances to service_role;
