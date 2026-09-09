-- Integration Token に用途(integration)と権限(scopes)を持たせる。
--
-- user_import_secrets は名前こそGAS寄りだが、実体は Flow+ の
-- Integration Token registry。rename は影響範囲が広いのでここでは行わず、
-- 内部的に汎用テーブルとして拡張する（docs/SECURITY.md に明記）。
--
-- これまでは「Tokenで認証できる = 全Integration APIを呼べる」だった。
-- GAS の取込用Tokenで投資可能額APIまで呼べてしまうため、scope を導入して
-- Least Privilege にする。

alter table user_import_secrets
  add column if not exists integration text not null default 'gas';

alter table user_import_secrets
  add column if not exists scopes text[] not null default '{}';

-- revoke は物理削除しない。いつ失効させたかを監査できるように残す。
-- 有効判定は is_active = true and revoked_at is null。
alter table user_import_secrets
  add column if not exists revoked_at timestamptz;

-- integration は CHECK で固定しない。値が増えるたびに Migration が必要になり、
-- 連携先の追加が重くなるため。妥当性はアプリ側の allowlist で担保する
-- (lib/integrations/scopes.ts)。

-- 既存Tokenの backfill。すべて GAS の取込用として発行されたもの。
-- 既に scopes が入っている行は触らない（再実行しても壊れない）。
update user_import_secrets
set integration = 'gas',
    scopes = array['transactions:write']
where scopes = '{}' or scopes is null;

create index if not exists user_import_secrets_active_idx
  on user_import_secrets (user_id, integration)
  where is_active and revoked_at is null;

-- 認証時の照合は secret_hash の完全一致。既存の unique 制約をそのまま使う。
