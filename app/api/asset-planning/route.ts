import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadAssetPlanning } from '@/lib/services/asset-planning-loader'
import { readFailed } from '@/lib/api-errors'
import { resolveMonthParam, todayJst } from '@/lib/jst'

export const dynamic = 'force-dynamic'

/**
 * GET /api/asset-planning?month=YYYY-MM
 *
 * 画面向けの資産形成プラン。認証はユーザーセッションで、DBアクセスは
 * セッションクライアント + RLS。Integration 用の
 * /api/integrations/investment-capacity（Token + service_role）を
 * UI から叩かないための入口。計算は共通の Loader を通すので複製しない。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const month = resolveMonthParam(request.nextUrl.searchParams.get('month'))

  try {
    const { plan, assets } = await loadAssetPlanning(user.id, month, todayJst(), supabase)
    return Response.json({ ...plan, assets })
  } catch (error) {
    return readFailed('api/asset-planning', error)
  }
}
