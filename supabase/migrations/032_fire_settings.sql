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
  -- **FIRE後**に継続する副業・事業収入。生活費のうち資産収入で賄わない分。
  -- 「FIREまでの資産形成を加速する追加積立」とは別の概念なので、同じ
  -- side_income という名前に寄せない（スペック §23 / §24）。加速側は
  -- Scenario Engine の入力で、保存しない。
  post_fire_monthly_income integer not null default 0
    check (post_fire_monthly_income >= 0),
  target_asset_income_monthly integer check (target_asset_income_monthly >= 0),
  -- 想定利回り。あくまで仮定であり保証ではない（スペック §22）
  assumed_return_rate numeric(6, 4) not null default 0.0400
    check (assumed_return_rate >= 0 and assumed_return_rate <= 0.20),
  -- 税率仮定。既定は 0%（税引前シミュレーション）。
  -- 取り崩し額へ一律 20.315% がかかる前提は取れない（NISA の非課税枠、元本
  -- 部分の取り崩し、控除の状況で実際の税額は変わる）。課税を見たいユーザーが
  -- 20.315%（課税を単純化した参考シナリオ）や独自の値を選ぶ。
  tax_rate numeric(6, 4) not null default 0
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

-- テーブルを既に作成済みの環境でも既定値を直せるようにする
-- （create table if not exists は既存テーブルの default を変えない）。
alter table fire_settings alter column tax_rate set default 0;

-- 旧名 side_income_monthly で作成済みの環境を追従させる。
-- 「FIRE後の収入」と「到達を加速する追加積立」を1つの名前で兼ねさせない。
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fire_settings'
      and column_name = 'side_income_monthly'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fire_settings'
      and column_name = 'post_fire_monthly_income'
  ) then
    alter table fire_settings rename column side_income_monthly to post_fire_monthly_income;
  end if;
end;
$$;
