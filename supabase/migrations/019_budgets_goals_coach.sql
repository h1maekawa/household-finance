-- V2.1〜V2.3: 予算エンジン / 目標(ライフゴール) / 日次コーチの洞察。
-- 金額は全て整数円。計算は lib/services/* の純関数が行い、ここは保存先のみ。

-- ---------------------------------------------------------------- 予算
create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text,                                 -- 'YYYY-MM'。null = 既定テンプレート
  income_planned integer,                     -- null なら users_profile.monthly_income
  fixed_planned integer,                      -- null なら scheduled_payments から算出
  investment_target integer not null default 0,
  savings_target integer not null default 0,
  buffer integer not null default 0,
  variable_budget_override integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

-- 月次予算のカテゴリ別サブ枠。source は 'ai' 提案 → ユーザー調整で 'manual' に変わる。
create table if not exists budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  budget_id uuid not null references budgets(id) on delete cascade,
  category text not null,
  amount integer not null,
  source text not null default 'ai' check (source in ('ai', 'manual', 'template', 'history')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, category)
);

-- ---------------------------------------------------------------- 目標
create table if not exists life_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'savings'
    check (kind in ('fire', 'house', 'car', 'education', 'savings', 'travel', 'custom')),
  title text not null,
  target_amount integer,
  target_date date,
  current_amount integer not null default 0,   -- 目標に紐づく現在額(手動更新 or 実績から同期)
  priority integer not null default 0,
  monthly_contribution integer,                -- 逆算した毎月の積立額
  status text not null default 'active' check (status in ('active', 'achieved', 'paused')),
  assumptions jsonb,                           -- 利回り・インフレ等の前提(MVPは単純積立・名目)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists life_goals_user_status_idx
  on life_goals (user_id, status, priority desc);

-- ---------------------------------------------------------------- コーチ
create table if not exists ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                          -- 'upcoming_debit' | 'category_over' | ...
  severity text not null default 'info' check (severity in ('info', 'warning', 'action')),
  title text not null,
  body text,
  payload jsonb,                               -- 構造化アクション(UI がバッジ・ボタン化する)
  status text not null default 'new' check (status in ('new', 'seen', 'dismissed', 'done')),
  generated_for date not null,
  created_at timestamptz not null default now(),
  unique (user_id, generated_for, type, title)
);

create index if not exists ai_insights_user_generated_idx
  on ai_insights (user_id, generated_for desc, status);

-- エージェントの長期記憶。オンボーディングの「何を重視するか」をここに保存し、
-- コーチの口調・優先度に反映する。
create table if not exists ai_user_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS
alter table budgets enable row level security;
alter table budget_categories enable row level security;
alter table life_goals enable row level security;
alter table ai_insights enable row level security;
alter table ai_user_memory enable row level security;

-- create policy に if not exists は無いので、drop → create で再実行可能にする。
drop policy if exists "budgets_select_own" on budgets;
create policy "budgets_select_own" on budgets for select using (auth.uid() = user_id);
drop policy if exists "budgets_insert_own" on budgets;
create policy "budgets_insert_own" on budgets for insert with check (auth.uid() = user_id);
drop policy if exists "budgets_update_own" on budgets;
create policy "budgets_update_own" on budgets for update using (auth.uid() = user_id);
drop policy if exists "budgets_delete_own" on budgets;
create policy "budgets_delete_own" on budgets for delete using (auth.uid() = user_id);

drop policy if exists "budget_categories_select_own" on budget_categories;
create policy "budget_categories_select_own" on budget_categories for select using (auth.uid() = user_id);
drop policy if exists "budget_categories_insert_own" on budget_categories;
create policy "budget_categories_insert_own" on budget_categories for insert with check (auth.uid() = user_id);
drop policy if exists "budget_categories_update_own" on budget_categories;
create policy "budget_categories_update_own" on budget_categories for update using (auth.uid() = user_id);
drop policy if exists "budget_categories_delete_own" on budget_categories;
create policy "budget_categories_delete_own" on budget_categories for delete using (auth.uid() = user_id);

drop policy if exists "life_goals_select_own" on life_goals;
create policy "life_goals_select_own" on life_goals for select using (auth.uid() = user_id);
drop policy if exists "life_goals_insert_own" on life_goals;
create policy "life_goals_insert_own" on life_goals for insert with check (auth.uid() = user_id);
drop policy if exists "life_goals_update_own" on life_goals;
create policy "life_goals_update_own" on life_goals for update using (auth.uid() = user_id);
drop policy if exists "life_goals_delete_own" on life_goals;
create policy "life_goals_delete_own" on life_goals for delete using (auth.uid() = user_id);

drop policy if exists "ai_insights_select_own" on ai_insights;
create policy "ai_insights_select_own" on ai_insights for select using (auth.uid() = user_id);
drop policy if exists "ai_insights_insert_own" on ai_insights;
create policy "ai_insights_insert_own" on ai_insights for insert with check (auth.uid() = user_id);
drop policy if exists "ai_insights_update_own" on ai_insights;
create policy "ai_insights_update_own" on ai_insights for update using (auth.uid() = user_id);
drop policy if exists "ai_insights_delete_own" on ai_insights;
create policy "ai_insights_delete_own" on ai_insights for delete using (auth.uid() = user_id);

drop policy if exists "ai_user_memory_select_own" on ai_user_memory;
create policy "ai_user_memory_select_own" on ai_user_memory for select using (auth.uid() = user_id);
drop policy if exists "ai_user_memory_insert_own" on ai_user_memory;
create policy "ai_user_memory_insert_own" on ai_user_memory for insert with check (auth.uid() = user_id);
drop policy if exists "ai_user_memory_update_own" on ai_user_memory;
create policy "ai_user_memory_update_own" on ai_user_memory for update using (auth.uid() = user_id);
drop policy if exists "ai_user_memory_delete_own" on ai_user_memory;
create policy "ai_user_memory_delete_own" on ai_user_memory for delete using (auth.uid() = user_id);

grant all on budgets to authenticated;
grant all on budgets to service_role;
grant all on budget_categories to authenticated;
grant all on budget_categories to service_role;
grant all on life_goals to authenticated;
grant all on life_goals to service_role;
grant all on ai_insights to authenticated;
grant all on ai_insights to service_role;
grant all on ai_user_memory to authenticated;
grant all on ai_user_memory to service_role;
