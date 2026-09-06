import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { requireActiveEntitlement } from '@/lib/entitlements'
import { issueToken, listTokens } from '@/lib/integrations/registry'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { readFailed, writeFailed } from '@/lib/api-errors'

/**
 * GAS 取込用 Token の発行・一覧。
 *
 * 既存のGAS運用を壊さないためパスを維持している。汎用の管理は
 * /api/integrations/tokens 側。scope はここでは受け取らず、
 * integration='gas' から transactions:write に固定される。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  try {
    const all = await listTokens(supabase, user.id)
    const secrets = all.filter(t => t.integration === 'gas' && t.is_active && !t.revoked_at)
    return Response.json({ secrets })
  } catch (error) {
    return readFailed('api/integrations/gas-secret', error)
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const allowed = await requireActiveEntitlement(user.id)
  if (!allowed) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  try {
    // 既存Tokenは失効させない。新旧を併存させてから古い方を revoke できる
    const { secret, record } = await issueToken(supabase, 'gas', 'GAS')
    return Response.json({ secret, record }, { status: 201 })
  } catch (error) {
    return writeFailed('api/integrations/gas-secret', error)
  }
}
