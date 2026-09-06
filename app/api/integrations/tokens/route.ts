import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { requireActiveEntitlement } from '@/lib/entitlements'
import { issueToken, listTokens } from '@/lib/integrations/registry'
import { isIntegration } from '@/lib/integrations/scopes'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { readFailed, writeFailed } from '@/lib/api-errors'

/** GET /api/integrations/tokens — 自分の Integration Token 一覧（secret_hash は返さない） */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  try {
    return Response.json({ tokens: await listTokens(supabase, user.id) })
  } catch (error) {
    return readFailed('api/integrations/tokens', error)
  }
}

/**
 * POST /api/integrations/tokens — Token を発行する。
 *
 * 受け取るのは integration と label だけ。scopes / user_id / is_active /
 * revoked_at 等はクライアントから指定できない（Mass Assignment 対策）。
 * 平文の Token はこのレスポンスでしか返さない。再表示はできない。
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const allowed = await requireActiveEntitlement(user.id)
  if (!allowed) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const integration = String(body.integration ?? '')
  if (!isIntegration(integration) || integration === 'other') {
    return Response.json(
      { error: 'integration は gas / ai_company のいずれかを指定してください' },
      { status: 400 }
    )
  }
  const label = String(body.label ?? integration).slice(0, 60)

  try {
    const { secret, record } = await issueToken(supabase, user.id, integration, label)
    return Response.json({ secret, record }, { status: 201 })
  } catch (error) {
    return writeFailed('api/integrations/tokens', error)
  }
}
