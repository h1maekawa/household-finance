-- AI Company の read-only token に、最小化済みカード明細の読取 scope を追加する。
-- 既存Tokenは認証時に DB保存scopeとの積集合を取るため、自動では権限が増えない。
-- 新しいTokenを発行し、AI Company側で安全にローテーションする。

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
    when 'ai_company' then array['finance-summary:read', 'investment-capacity:read', 'assets:read', 'card-activity:read']
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

revoke all on function issue_integration_token(text, text, text) from anon, public;
grant execute on function issue_integration_token(text, text, text) to authenticated;
