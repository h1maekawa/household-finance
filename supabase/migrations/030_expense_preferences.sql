-- 支出価値タグ。
--
-- 家計カテゴリ（食費・外食…）とは別に、「その支出を自分にとってどう扱うか」を
-- 保存する。AIやシステムが「タバコ=見直し候補」のように決め打ちしないための、
-- ユーザー自身の価値観の置き場所。
--
--   essential  必須
--   flexible   改善可能
--   enjoyment  楽しみ
--   review     見直し候補
--
-- 未設定は行が無い＝null。「まだ決めていない」と「必須と決めた」は別物として扱う。

create table if not exists expense_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  value_tag text not null check (value_tag in ('essential', 'flexible', 'enjoyment', 'review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

alter table expense_preferences enable row level security;

-- ここは本人が自由に設定してよい値なので、通常のRLSで読み書きさせる。
-- 金額や権限には影響しない
drop policy if exists expense_preferences_select_own on expense_preferences;
create policy expense_preferences_select_own on expense_preferences
  for select using (auth.uid() = user_id);
drop policy if exists expense_preferences_insert_own on expense_preferences;
create policy expense_preferences_insert_own on expense_preferences
  for insert with check (auth.uid() = user_id);
drop policy if exists expense_preferences_update_own on expense_preferences;
create policy expense_preferences_update_own on expense_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists expense_preferences_delete_own on expense_preferences;
create policy expense_preferences_delete_own on expense_preferences
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on expense_preferences to authenticated;
