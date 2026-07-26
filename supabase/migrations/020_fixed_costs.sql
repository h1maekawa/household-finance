-- V3.0: 固定費を「どの口座から・どう補正して・いくら」まで管理できるようにする。
-- 要件書 §8「固定費管理」の管理項目に対応。金額計算は lib/services/fixed-costs.ts の純関数が行い、
-- ここは保存先のみ。既存行の挙動を変えないよう、全ての default は現状の暗黙値と一致させる。

alter table scheduled_payments
  -- 支払方法。'credit_card' の場合は自分では銀行引落を生まず、credit_card_id のカード請求に合流する。
  add column if not exists payment_method text not null default 'bank_debit',
  add column if not exists credit_card_id uuid references credit_cards(id) on delete set null,
  -- 契約期間。null = 無期限(既存行はすべてこれ)
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists recurrence text not null default 'monthly',
  -- 支払日が土日祝のときの金融機関営業日補正。
  -- 既定は 'none': 既存行の予測日を勝手に動かさないため。新規登録UIでは 'next' を初期値にする。
  add column if not exists business_day_rule text not null default 'none',
  -- 外貨連動の固定費(例: ジブラルタ生命 105 USD)。JPY なら amount をそのまま使う。
  add column if not exists currency text not null default 'JPY',
  add column if not exists foreign_amount numeric;

-- check 制約は再実行できるよう drop → add で置く。
alter table scheduled_payments drop constraint if exists scheduled_payments_payment_method_check;
alter table scheduled_payments add constraint scheduled_payments_payment_method_check
  check (payment_method in ('bank_debit', 'credit_card', 'cash', 'other'));

alter table scheduled_payments drop constraint if exists scheduled_payments_recurrence_check;
alter table scheduled_payments add constraint scheduled_payments_recurrence_check
  check (recurrence in ('monthly', 'yearly', 'once'));

alter table scheduled_payments drop constraint if exists scheduled_payments_business_day_rule_check;
alter table scheduled_payments add constraint scheduled_payments_business_day_rule_check
  check (business_day_rule in ('none', 'next', 'previous'));

-- 固定費一覧・キャッシュフロー予測・コーチが全てここを叩く。
create index if not exists scheduled_payments_user_active_idx
  on scheduled_payments (user_id, is_active, due_day);

-- 引き落とし口座での絞り込み(「三井住友から出ていく固定費」)。
create index if not exists scheduled_payments_debit_account_idx
  on scheduled_payments (debit_account_id)
  where debit_account_id is not null;

-- fx_rates は migration 001 で作成済み(pair に unique 済み、RLS は read_all の select のみ)。
-- 全ユーザー共通のマスタデータなので、読みは認証ユーザー、書き(レート更新)は service_role に限定する。
-- 「ユーザー文脈が無い管理操作は service_role」という docs/v3-architecture-review.md §9 の方針どおり。
-- 認証ユーザーに insert/update を与えると、1ユーザーが全ユーザーの為替レートを書き換えられてしまう。
grant select on fx_rates to authenticated;
grant all on fx_rates to service_role;
