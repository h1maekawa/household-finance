-- supabase/migrations/021_fixed_cost_amount_type.sql
--
-- 固定費に「固定額 / 変動額」の区別と、カード利用メールとの照合キーワードを持たせる。
--
-- amount_type:
--   'fixed'    … 家賃・楽天モバイルのように毎月同額。amount がそのまま請求額。
--   'variable' … 電気代・保険のように月ごとに動く。amount は「予定額」であって確定額ではない。
--                実際の請求額は 確定 > 予定 > 直近3ヶ月平均 の順で決める
--                (lib/services/fixed-costs.ts の resolveVariableAmount)。
--
-- match_keywords:
--   カード利用メールの摘要と突き合わせるキーワード。これが無いと
--   「固定費の予測」と「実際に取り込まれたカード利用」が同じカード請求に
--   二重計上される(実データで月31,000円ぶん発生していた)。
--   推測で埋めるとむしろ誤照合を生むため、既定は空配列にしてある。

alter table scheduled_payments
  add column if not exists amount_type text not null default 'fixed',
  add column if not exists match_keywords text[] not null default '{}';

alter table scheduled_payments drop constraint if exists scheduled_payments_amount_type_check;
alter table scheduled_payments add constraint scheduled_payments_amount_type_check
  check (amount_type in ('fixed', 'variable'));

comment on column scheduled_payments.amount_type is '固定額(fixed) か 変動額(variable) か。variable の amount は予定額';
comment on column scheduled_payments.match_keywords is 'カード利用メールの摘要と突合するキーワード。空なら照合しない';

grant all on scheduled_payments to authenticated;
grant all on scheduled_payments to service_role;
