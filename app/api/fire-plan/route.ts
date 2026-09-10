import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadFirePlan } from '@/lib/services/fire-planner-loader'
import { readFailed } from '@/lib/api-errors'
import { resolveMonthParam, todayJst } from '@/lib/jst'

export const dynamic = 'force-dynamic'

/**
 * GET /api/fire-plan?month=YYYY-MM
 *
 * FIRE に必要な資産と不足額。ユーザーセッション + RLS。
 * 総資産・毎月の積立額は asset-planning が出した値を使うので、
 * 同じ数字が画面ごとに食い違わない。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const month = resolveMonthParam(request.nextUrl.searchParams.get('month'))

  try {
    const { plan, settings } = await loadFirePlan(user.id, month, todayJst(), supabase)
    return Response.json({ ...plan, settings })
  } catch (error) {
    return readFailed('api/fire-plan', error)
  }
}
