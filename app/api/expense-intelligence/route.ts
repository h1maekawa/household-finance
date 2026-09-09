import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadExpenseIntelligence } from '@/lib/services/expense-intelligence-loader'
import { readFailed } from '@/lib/api-errors'

export const dynamic = 'force-dynamic'

function currentMonthJst(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit',
  }).format(new Date())
}

/**
 * GET /api/expense-intelligence?month=YYYY-MM
 * カテゴリ別の支出分析と見直し候補。ユーザーセッション + RLS。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const monthParam = request.nextUrl.searchParams.get('month')
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '') ? (monthParam as string) : currentMonthJst()

  try {
    return Response.json(await loadExpenseIntelligence(user.id, month, supabase))
  } catch (error) {
    return readFailed('api/expense-intelligence', error)
  }
}
