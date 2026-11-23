import { NextRequest } from 'next/server'
import { requireIntegrationScope } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase'
import { computeInvestmentCapacity } from '@/lib/services/investment-capacity'
import { readFailed } from '@/lib/api-errors'
import { loadCapacityInput } from '@/lib/services/capacity-input'
import { resolveMonthParam } from '@/lib/jst'

export const dynamic = 'force-dynamic'

/**
 * GET /api/integrations/investment-capacity?month=YYYY-MM
 *
 * AI Company（投資部門）向けのサーバー間API。
 * 当月の投資可能額と、その内訳を返す。
 * 認証は x-import-secret ヘッダー。scope は investment-capacity:read。
 * GAS の取込用Token（transactions:write のみ）では呼べない。
 */
export async function GET(request: NextRequest) {
  const result = await requireIntegrationScope(request, 'investment-capacity:read')
  if ('response' in result) return result.response
  const userId = result.auth.userId

  const month = resolveMonthParam(request.nextUrl.searchParams.get('month'))
  // 1リクエストで1つの時刻を使う（鮮度判定・「今日」・calculated_at を揃える）
  const now = new Date()

  try {
    // 入力の組み立ては loadCapacityInput に一本化（資産計画と同じ数字にする）
    const { context, ...input } = await loadCapacityInput(userId, month, now, supabaseAdmin)
    const capacity = computeInvestmentCapacity(input)
    const budget = context.budgetLoad.summary

    return Response.json({
      ...capacity,
      // 算出時刻は純関数の外（I/O境界）で付ける。既存レスポンスとの互換のため維持する
      calculated_at: now.toISOString(),
      emergency_fund: context.emergencyFund,
      // 家計側の「今月あといくら使えるか」もそのまま渡す
      living: {
        variable_budget: budget.variable.budget,
        spent: budget.variable.spent,
        remaining: budget.variable.remaining,
        days_left: budget.variable.daysLeft,
        daily_allowance: budget.variable.dailyAllowance,
        pace: budget.variable.pace,
      },
      balance_recorded_at: context.liquidCash.recordedAt,
      liquid_cash_source: context.liquidCash.source,
      source: context.budgetLoad.source,
    })
  } catch (error) {
    // DBやライブラリの詳細をクライアントへ返さない（詳細はサーバーログへ）
    return readFailed('api/integrations/investment-capacity', error)
  }
}
