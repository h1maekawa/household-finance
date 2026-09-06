// lib/integrations/registry.ts
//
// Integration Token の発行・一覧・失効。
//
// user_import_secrets は名前こそGAS寄りだが、実体は Flow+ の
// Integration Token registry（rename は別Phase。docs/SECURITY.md 参照）。
//
// scope はクライアントから受け取らず、integration からサーバー側で決める
// （scope escalation の防止）。
import type { SupabaseClient } from '@supabase/supabase-js'
import { createIntegrationSecret, hashImportSecret } from '@/lib/import-secrets'
import type { Integration } from './scopes'

/**
 * クライアントへ返してよい列。
 * secret_hash は絶対に含めない（RLSで自分の行が読めても、APIから出さない）。
 */
export const TOKEN_PUBLIC_COLUMNS =
  'id,label,integration,scopes,is_active,created_at,last_used_at,revoked_at'

export type IntegrationTokenRecord = {
  id: string
  label: string
  integration: string
  scopes: string[]
  is_active: boolean
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

/**
 * Token を発行する。平文はこの戻り値でしか手に入らない。
 * DBにはハッシュだけを保存し、再表示はできない。
 *
 * 発行は SECURITY DEFINER の関数を通す（027）。authenticated ロールから
 * user_import_secrets への直接INSERTは剥がしてあるので、REST を直接
 * 叩いても scope 付きの行は作れない。対象ユーザーは関数内の auth.uid() が
 * 決めるため、user_id をクライアントから渡さない。
 */
export async function issueToken(
  supabase: SupabaseClient,
  integration: Integration,
  label: string
): Promise<{ secret: string; record: IntegrationTokenRecord }> {
  const secret = createIntegrationSecret(integration)

  const { data, error } = await supabase.rpc('issue_integration_token', {
    p_secret_hash: hashImportSecret(secret),
    p_integration: integration,
    p_label: label,
  })

  if (error) throw error
  return { secret, record: data as IntegrationTokenRecord }
}

/** 有効なTokenの一覧。Rotation 中は複数返る */
export async function listTokens(
  supabase: SupabaseClient,
  userId: string
): Promise<IntegrationTokenRecord[]> {
  const { data, error } = await supabase
    .from('user_import_secrets')
    .select(TOKEN_PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as IntegrationTokenRecord[]
}

/**
 * Token を失効させる。物理削除しないので、いつ誰が失効させたか追える。
 * 認証側は is_active かつ revoked_at is null だけを通す。
 *
 * 失効は不可逆。DBのトリガーが復活を拒否するので、一度失効させたTokenは
 * 戻せない（必要なら新しいTokenを発行する）。
 */
export async function revokeToken(
  supabase: SupabaseClient,
  tokenId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('revoke_integration_token', {
    p_token_id: tokenId,
  })

  if (error) throw error
  return data === true
}
