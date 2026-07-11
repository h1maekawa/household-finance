-- supabase/migrations/013_credit_card_plan.sql
-- credit_cards テーブルに card_type / card_plan カラムを追加する。
-- 既存レコードはデフォルト値 'generic' で維持され、設定画面から後から変更可能。

alter table credit_cards
  add column if not exists card_type text not null default 'generic',
  add column if not exists card_plan text not null default 'generic';

-- 値の制約（任意：後から制約を加えたい場合は check を追加する）
-- alter table credit_cards
--   add constraint credit_cards_card_type_check
--     check (card_type in ('rakuten', 'smbc', 'generic')),
--   add constraint credit_cards_card_plan_check
--     check (card_plan in ('rakuten_standard', 'rakuten_market', 'smbc_10th', 'smbc_26th', 'generic'));

comment on column credit_cards.card_type is 'カード種別: rakuten | smbc | generic';
comment on column credit_cards.card_plan is 'カードプラン: rakuten_standard | rakuten_market | smbc_10th | smbc_26th | generic';
