-- 現金防衛資金の設定。
--
-- 「生活費の何か月分を現金として持っておくか」はユーザーが決める値で、
-- 既存スキーマのどこにも無いので users_profile へ追加する。
-- 既定は3か月。Projection の結果は derived data なので保存しない。

alter table users_profile
  add column if not exists emergency_fund_months integer not null default 3
  check (emergency_fund_months between 0 and 24);
