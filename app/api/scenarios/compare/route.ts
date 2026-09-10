import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  isScenarioTargetKind,
  loadScenarioComparison,
  type ScenarioRequest,
} from '@/lib/services/scenario-loader'
import { DEFAULT_RETURN_RATE } from '@/lib/services/return-assumptions'
import { readFailed } from '@/lib/api-errors'
import { resolveMonthParam, todayJst } from '@/lib/jst'

export const dynamic = 'force-dynamic'

/** 追加額。負の値は0へ正規化する（スペック §29） */
function additionalYen(value: unknown): number {
  const parsed = Math.round(Number(value) || 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function parseRequest(body: Record<string, unknown>): ScenarioRequest {
  const reduction = (body.expense_reduction ?? null) as Record<string, unknown> | null
  const category = typeof reduction?.category === 'string' ? reduction.category.trim() : ''

  return {
    targetKind: isScenarioTargetKind(body.target_kind) ? body.target_kind : 'goal',
    goalId: typeof body.goal_id === 'string' && body.goal_id ? body.goal_id : null,
    additionalMonthlySavings: additionalYen(body.additional_monthly_savings),
    additionalMonthlyInvestment: additionalYen(body.additional_monthly_investment),
    monthlyExpenseReduction: additionalYen(body.monthly_expense_reduction),
    expenseReduction: category
      ? { category: category.slice(0, 40), ratio: Number(reduction?.ratio) || 0 }
      : null,
    monthlyExtraContribution: additionalYen(body.monthly_extra_contribution),
    annualReturnRate:
      body.annual_return_rate === undefined || body.annual_return_rate === null
        ? DEFAULT_RETURN_RATE
        : Number(body.annual_return_rate) || 0,
  }
}

/**
 * POST /api/scenarios/compare
 *
 * 「条件を変えると目標到達がどう変わるか」を返す。
 *
 *   認証 → 現在のSourceを取得 → scenario-engine → response
 *
 * 金融計算は純関数（scenario-engine.ts）が持つ。ここは組み立てない。
 * 結果は保存しない（スペック §25）。ユーザーセッション + RLS。
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const month = resolveMonthParam(request.nextUrl.searchParams.get('month'))
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  try {
    return Response.json(
      await loadScenarioComparison(user.id, parseRequest(body), month, todayJst(), supabase)
    )
  } catch (error) {
    return readFailed('api/scenarios/compare', error)
  }
}
