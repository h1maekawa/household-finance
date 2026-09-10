import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadCashflow } from '@/lib/services/cashflow-loader'
import { readFailed } from '@/lib/api-errors'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cashflow
 *
 * 残高予測とカード請求。パイプラインは cashflow-loader が持つ
 * （Action Planner も同じ結果を使うので、2箇所へ写さない）。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  try {
    return Response.json(await loadCashflow(user.id, supabase))
  } catch (error) {
    return readFailed('api/cashflow', error)
  }
}
