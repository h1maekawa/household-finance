import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadMonthlyActions } from '@/lib/services/action-planner-loader'
import { readFailed } from '@/lib/api-errors'
import { resolveMonthParam, todayJst } from '@/lib/jst'

export const dynamic = 'force-dynamic'

/**
 * GET /api/actions?month=YYYY-MM
 *
 * 「今月やること」。何を出すかの判断はサーバー（action-planner.ts）が持つ。
 * 以前は Home の JSX が5つのAPIを見て条件分岐で組み立てていた。
 * ユーザーセッション + RLS。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const month = resolveMonthParam(request.nextUrl.searchParams.get('month'))

  try {
    return Response.json(await loadMonthlyActions(user.id, month, todayJst(), supabase))
  } catch (error) {
    return readFailed('api/actions', error)
  }
}
