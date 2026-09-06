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
import { scopesForIntegration, type Integration } from './scopes'

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
 */
export async function issueToken(
  supabase: SupabaseClient,
  userId: string,
  integration: Integration,
  label: string
): Promise<{ secret: string; record: IntegrationTokenRecord }> {
  const secret = createIntegrationSecret(integration)

  const { data, error } = await supabase
    .from('user_import_secrets')
    .insert([
      {
        user_id: userId,
        secret_hash: hashImportSecret(secret),
        label,
        integration,
        // クライアントの指定は使わない。連携先から一意に決める
        scopes: scopesForIntegration(integration),
      },
    ])
    .select(TOKEN_PUBLIC_COLUMNS)
    .single()

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
 */
export async function revokeToken(
  supabase: SupabaseClient,
  userId: string,
  tokenId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_import_secrets')
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id')

  if (error) throw error
  return (data ?? []).length > 0
}
