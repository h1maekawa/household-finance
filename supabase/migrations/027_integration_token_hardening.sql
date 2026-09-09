-- Integration Token の scope を DB レベルで守る。
--
-- 009 で authenticated ロールに user_import_secrets の INSERT/UPDATE/DELETE を
-- 許可しているため、API が scope をサーバー決定していても、ユーザーが
-- Supabase の REST を直接叩いて自分のToken行の scopes を書き換えられた。
--   例) integration='gas' の行へ assets:read を足す
-- 「クライアントから scope を自由に指定できない」を DB でも満たすようにする。
--
-- 方針: ユーザーは自分の Token の metadata を読むだけ。発行と失効は
-- SECURITY DEFINER の関数を通す。関数は auth.uid() で対象ユーザーを決め、
-- user_id をクライアントから受け取らない。

/* ── 発行 ─────────────────────────────────────── */

-- 平文Tokenの生成は Node 側。DBへ渡すのはハッシュだけ。
-- scopes は引数で受け取らず、integration から決める（scope escalation の防止）。
-- lib/integrations/scopes.ts の ALLOWED_SCOPES と一致させること
-- （lib/integrations/rpc-contract.test.ts が突き合わせる）。
create or replace function issue_integration_token(
  p_secret_hash text,
  p_integration text,
  p_label text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_scopes text[];
  v_row user_import_secrets;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  v_scopes := case p_integration
    when 'gas' then array['transactions:write']
    when 'ai_company' then array['finance-summary:read', 'investment-capacity:read', 'assets:read']
    else null
  end;

  if v_scopes is null then
    raise exception 'unsupported integration: %', p_integration;
  end if;

  insert into user_import_secrets (user_id, secret_hash, label, integration, scopes)
  values (
    v_user,
    p_secret_hash,
    coalesce(nullif(btrim(p_label), ''), p_integration),
    p_integration,
    v_scopes
  )
  returning * into v_row;

  -- secret_hash は返さない
  return jsonb_build_object(
    'id', v_row.id,
    'label', v_row.label,
    'integration', v_row.integration,
    'scopes', v_row.scopes,
    'is_active', v_row.is_active,
    'created_at', v_row.created_at,
    'last_used_at', v_row.last_used_at,
    'revoked_at', v_row.revoked_at
  );
end;
$$;

/* ── 失効 ─────────────────────────────────────── */

create or replace function revoke_integration_token(p_token_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  update user_import_secrets
  set is_active = false,
      revoked_at = now()
  where id = p_token_id
    and user_id = v_user
    and revoked_at is null;

  return found;
end;
$$;

/* ── 失効したTokenを復活させない ───────────────── */

-- 権限を剥がしても、将来の service_role 経由の処理やSQL Editorでの
-- 手作業で復活できてしまうと意味がない。失効は不可逆にする。
-- 失効後に許すのは last_used_at 等の付随情報の更新だけ。
create or replace function prevent_integration_token_revival()
returns trigger
language plpgsql
as $$
begin
  if old.revoked_at is not null then
    if new.revoked_at is null or (new.is_active and not old.is_active) then
      raise exception 'revoked integration token cannot be reactivated';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists user_import_secrets_no_revival on user_import_secrets;
create trigger user_import_secrets_no_revival
  before update on user_import_secrets
  for each row execute function prevent_integration_token_revival();

/* ── 直接の書き込み権限を落とす ─────────────────── */

-- SELECT は残す（自分のTokenのmetadataは見える）。
-- INSERT/UPDATE/DELETE は関数経由のみ。
drop policy if exists insert_own on user_import_secrets;
drop policy if exists update_own on user_import_secrets;
drop policy if exists delete_own on user_import_secrets;

revoke insert, update, delete on user_import_secrets from authenticated;
grant select on user_import_secrets to authenticated;

grant execute on function issue_integration_token(text, text, text) to authenticated;
grant execute on function revoke_integration_token(uuid) to authenticated;
revoke all on function issue_integration_token(text, text, text) from anon, public;
revoke all on function revoke_integration_token(uuid) from anon, public;
