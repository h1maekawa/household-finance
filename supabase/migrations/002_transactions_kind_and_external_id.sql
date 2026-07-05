-- Add income/expense classification and an external_id for import dedup
-- (Gmail取り込みなど外部連携からの重複登録防止に使う)

alter table transactions
  add column if not exists kind text not null default 'expense'
    check (kind in ('income', 'expense'));

alter table transactions
  add column if not exists external_id text;

-- external_idがある行(=外部連携で登録された行)に限り、
-- 同じユーザー内で同じexternal_idの重複登録を防ぐ。
-- 手入力・チャット入力(external_id is null)には影響しない。
create unique index if not exists transactions_user_external_id_idx
  on transactions (user_id, external_id)
  where external_id is not null;
