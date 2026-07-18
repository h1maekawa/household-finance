-- チャットボット等から動的に追加できるユーザー定義カテゴリ
-- 既定カテゴリ(types/transaction.ts の CATEGORIES)にマージして使う

create table if not exists custom_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  icon text not null default '📦',
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  is_fixed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

alter table custom_categories enable row level security;

create policy "custom_categories_select_own"
  on custom_categories for select
  using (auth.uid() = user_id);

create policy "custom_categories_insert_own"
  on custom_categories for insert
  with check (auth.uid() = user_id);

create policy "custom_categories_update_own"
  on custom_categories for update
  using (auth.uid() = user_id);

create policy "custom_categories_delete_own"
  on custom_categories for delete
  using (auth.uid() = user_id);
