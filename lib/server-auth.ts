import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { hashImportSecret } from '@/lib/import-secrets'
import {
  effectiveScopes,
  type IntegrationScope,
} from '@/lib/integrations/scopes'
import { supabaseAdmin } from '@/lib/supabase'

function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/**
 * サーバー間連携（GAS取込・AI Companyなど）の認証結果。
 *
 * userId だけでは scope 認可ができないため、Token の素性ごと返す。
 * ここに secret / secret_hash は含めない（呼び出し側へ漏らさない）。
 */
export type IntegrationAuthContext = {
  userId: string
  /** 環境変数のレガシーSecretで通った場合は null */
  tokenId: string | null
  integration: string
  scopes: IntegrationScope[]
  legacy: boolean
}

/**
 * `x-import-secret` ヘッダーから連携元を解決する。
 *
 * 有効判定は is_active かつ revoked_at が null。revoke した Token は
 * 行を残したまま失効する（監査のため物理削除しない）。
 *
 * last_used_at は「認証に成功した」時点で更新する。この後 scope 不足で
 * 403 になっても更新済みのままにする。Token が使われた事実自体は
 * 追跡したいため（docs/SECURITY.md に方針を記載）。
 */
export async function resolveIntegrationAuth(
  request: NextRequest
): Promise<IntegrationAuthContext | null> {
  const provided = request.headers.get('x-import-secret')
  if (!provided) return null

  const { data, error } = await supabaseAdmin
    .from('user_import_secrets')
    .select('id,user_id,integration,scopes,is_active,revoked_at')
    .eq('secret_hash', hashImportSecret(provided))
    .is('revoked_at', null)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.error('[integration-auth] Token の照合に失敗:', error.message)
    return null
  }

  if (data?.user_id) {
    // 監査情報の更新。失敗しても認証は続けるが、黙って消さない
    const { error: touchError } = await supabaseAdmin
      .from('user_import_secrets')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
    if (touchError) {
      console.warn(`[integration-auth] last_used_at の更新に失敗: ${touchError.message}`)
    }

    const integration = data.integration ?? 'gas'
    return {
      userId: data.user_id,
      tokenId: data.id,
      integration,
      // 保存値をそのまま信じない。既知scope かつ その連携先に許された scope だけ。
      // DBを直接書き換えられても、integration の範囲を超えた権限にはならない
      scopes: effectiveScopes(integration, data.scopes),
      legacy: false,
    }
  }

  // 旧方式（環境変数の共有シークレット）。Stage A として当面受け付ける。
  // 用途は過去のGAS取込に限るので、scope は transactions:write だけ。
  if (
    process.env.GAS_IMPORT_SECRET &&
    process.env.GAS_IMPORT_USER_ID &&
    secretsMatch(provided, process.env.GAS_IMPORT_SECRET)
  ) {
    console.warn('[deprecated] Legacy GAS integration secret used')
    return {
      userId: process.env.GAS_IMPORT_USER_ID,
      tokenId: null,
      integration: 'gas',
      scopes: ['transactions:write'],
      legacy: true,
    }
  }

  return null
}

/**
 * 後方互換ラッパー。新規コードは resolveIntegrationAuth を使うこと。
 * scope を見ないので、これだけで認可を済ませてはいけない。
 */
export async function resolveIntegrationUserId(request: NextRequest): Promise<string | null> {
  const auth = await resolveIntegrationAuth(request)
  return auth?.userId ?? null
}

export function hasIntegrationScope(
  auth: IntegrationAuthContext | null,
  scope: IntegrationScope
): boolean {
  return Boolean(auth?.scopes.includes(scope))
}

/**
 * 認証と scope 認可をまとめて行う。各ルートへ比較ロジックをコピペしない。
 *
 * 401 … Token が無い・不正・失効・無効
 * 403 … Token は正しいが必要な scope が無い
 */
export async function requireIntegrationScope(
  request: NextRequest,
  scope: IntegrationScope
): Promise<{ auth: IntegrationAuthContext } | { response: Response }> {
  const auth = await resolveIntegrationAuth(request)
  if (!auth) {
    return { response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!hasIntegrationScope(auth, scope)) {
    return {
      response: Response.json(
        { error: 'Forbidden', required_scope: scope },
        { status: 403 }
      ),
    }
  }
  return { auth }
}
