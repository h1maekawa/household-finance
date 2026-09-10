-- FIRE Planner の入力（スペック §20）。
--
--   月の生活費 / 資産収入目標 / 副業収入 / 想定利回り / 税率仮定 / FIRE Type
--
-- 計算結果（必要資産・不足額・シナリオ比較）は derived data なので保存しない。
-- 入力条件だけを保存して、読むたびに再計算する（スペック §56）。
--
-- null の扱い:
--   monthly_living_cost が null … 「未入力」。0円ではない。
--     0 を既定値にすると「生活費0円 = 必要資産0円 = FIRE達成済み」と
--     表示されてしまう。未入力のときは家計側の必須生活費を推定に使い、
--     それも出せなければ「算出不能」と出す。
--   target_asset_income_monthly が null … 生活費と副業収入から逆算する。
--     値が入っていればそちらを優先する（ユーザーの意図を上書きしない）。

create table if not exists fire_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- 完全FIRE: 生活費すべてを資産収入で賄う / 半FIRE: 副業・事業収入と合わせる
  fire_type text not null default 'semi' check (fire_type in ('full', 'semi')),
  monthly_living_cost integer check (monthly_living_cost >= 0),
  side_income_monthly integer not null default 0 check (side_income_monthly >= 0),
  target_asset_income_monthly integer check (target_asset_income_monthly >= 0),
  -- 想定利回り。あくまで仮定であり保証ではない（スペック §22）
  assumed_return_rate numeric(6, 4) not null default 0.0400
    check (assumed_return_rate >= 0 and assumed_return_rate <= 0.20),
  -- 税率仮定。既定は上場株式等の申告分離課税 20.315%
  tax_rate numeric(6, 4) not null default 0.20315
    check (tax_rate >= 0 and tax_rate < 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table fire_settings enable row level security;

-- 自分の設定だけを読み書きする。行ごとの不変条件は check 制約で足りるので、
-- transaction_items / goal_milestones と違い関数経由にはしない
drop policy if exists fire_settings_select_own on fire_settings;
create policy fire_settings_select_own on fire_settings
  for select using (auth.uid() = user_id);

drop policy if exists fire_settings_insert_own on fire_settings;
create policy fire_settings_insert_own on fire_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists fire_settings_update_own on fire_settings;
create policy fire_settings_update_own on fire_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists fire_settings_delete_own on fire_settings;
create policy fire_settings_delete_own on fire_settings
  for delete using (auth.uid() = user_id);
