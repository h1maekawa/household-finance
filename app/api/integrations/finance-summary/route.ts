import type { NextRequest } from 'next/server'
import { requireIntegrationScope } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase'
import { readFailed } from '@/lib/api-errors'
import { resolveMonthParam, todayJst } from '@/lib/jst'
import { loadAssetPlanning } from '@/lib/services/asset-planning-loader'
import { loadCashflow } from '@/lib/services/cashflow-loader'
import { buildFinanceSummary } from '@/lib/services/finance-summary'
import { monthEnd, monthStart } from '@/lib/services/budget-loader'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const result = await requireIntegrationScope(request, 'finance-summary:read')
  if ('response' in result) return result.response

  const month = resolveMonthParam(request.nextUrl.searchParams.get('month'))
  const userId = result.auth.userId

  try {
    const [planning, cashflow, reviewRes] = await Promise.all([
      loadAssetPlanning(userId, month, todayJst(), supabaseAdmin),
      loadCashflow(userId, supabaseAdmin),
      supabaseAdmin
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('needs_review', true)
        .gte('date', monthStart(month))
        .lte('date', monthEnd(month)),
    ])

    if (reviewRes.error) {
      throw new Error(`transactions の取得に失敗しました: ${reviewRes.error.message}`)
    }

    return Response.json(buildFinanceSummary({
      planning,
      cashflow,
      unreviewedTransactions: reviewRes.count ?? 0,
      generatedAt: new Date().toISOString(),
    }))
  } catch (error) {
    return readFailed('api/integrations/finance-summary', error)
  }
}
