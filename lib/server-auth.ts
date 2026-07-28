import { timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import { hashImportSecret } from '@/lib/import-secrets'
import { supabaseAdmin } from '@/lib/supabase'

function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/**
 * サーバー間連携（GAS取込・AI Companyなど）の認証。
 * `x-import-secret` ヘッダーを user_import_secrets と突き合わせ、対象ユーザーを返す。
 * ブラウザのセッションとは別経路なので、シークレットはクライアントへ出さないこと。
 */
export async function resolveIntegrationUserId(request: NextRequest): Promise<string | null> {
  const provided = request.headers.get('x-import-secret')
  if (!provided) return null

  const { data } = await supabaseAdmin
    .from('user_import_secrets')
    .select('id,user_id')
    .eq('secret_hash', hashImportSecret(provided))
    .eq('is_active', true)
    .maybeSingle()

  if (data?.user_id) {
    await supabaseAdmin
      .from('user_import_secrets')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
    return data.user_id
  }

  // 旧方式（環境変数の共有シークレット）も引き続き受け付ける
  if (
    process.env.GAS_IMPORT_SECRET &&
    process.env.GAS_IMPORT_USER_ID &&
    secretsMatch(provided, process.env.GAS_IMPORT_SECRET)
  ) {
    return process.env.GAS_IMPORT_USER_ID
  }

  return null
}
