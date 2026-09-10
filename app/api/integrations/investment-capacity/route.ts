import { NextRequest } from 'next/server'
import { requireIntegrationScope } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase'
import { loadBudget } from '@/lib/services/budget-loader'
import { computeInvestmentCapacity } from '@/lib/services/investment-capacity'
import { getMergedCategories } from '@/lib/categories'
import { readFailed } from '@/lib/api-errors'
import { computeEmergencyFund } from '@/lib/services/emergency-fund'
import { loadLiquidCash } from '@/lib/services/liquid-cash-loader'
import { essentialMonthlyExpenses } from '@/lib/services/asset-planning'
import { isCardBillPayment, isInvestmentCategory } from '@/lib/services/money-plan'
import { resolveMonthParam, todayJst } from '@/lib/jst'

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
  const today = todayJst()
  const monthStart = `${month}-01`
  const monthEnd = `${month}-31`

  try {
    const [budgetLoad, liquidCash, scheduledRes, investmentRes, categories, profileRes] = await Promise.all([
      loadBudget(userId, month, today, supabaseAdmin),
      loadLiquidCash(userId, supabaseAdmin),
      supabaseAdmin
        .from('scheduled_payments')
        .select('name, amount, memo, type, is_active, scheduled_date, category')
        .eq('user_id', userId)
        .eq('is_active', true),
      supabaseAdmin
        .from('investment_transactions')
        .select('trade_date, amount, side')
        .eq('user_id', userId)
        .gte('trade_date', monthStart)
        .lte('trade_date', monthEnd),
      getMergedCategories(userId, supabaseAdmin),
      supabaseAdmin
        .from('users_profile')
        .select('emergency_fund_months')
        .eq('user_id', userId)
        .maybeSingle(),
    ])

    // 金融計算では「DB取得失敗 = 0円」にしない。欠損のまま計算すると
    // 未払い予定が0円になり、投資余力が実態より大きく出る
    for (const [label, res] of [
      ['scheduled_payments', scheduledRes],
      ['investment_transactions', investmentRes],
      ['users_profile', profileRes],
    ] as const) {
      if (res.error) throw new Error(`${label} の取得に失敗しました: ${res.error.message}`)
    }

    const budget = budgetLoad.summary
    const missingData: string[] = []

    // 口座残高。未登録なら投資余力は算出できない
    const availableCash = liquidCash.amount
    if (availableCash === null) missingData.push('口座残高が未登録です')
    if (budget.income.planned === 0) missingData.push('月収の設定がありません')

    // 今月これから入る収入
    const expectedIncome = Math.max(0, budget.income.planned - budget.income.actual)

    // 未引落のカード請求と、それ以外の引落予定を分ける
    const scheduled = scheduledRes.data ?? []
    const fixedNames = new Set(categories.fixedNames)
    let pendingCardAmount = 0
    let scheduledExpenses = 0
    // 積立投資は生活固定費ではない。防衛資金の必要額に含めないため分けて集計する
    let investmentFixed = 0
    for (const payment of scheduled) {
      const amount = Number(payment.amount) || 0
      if (isCardBillPayment(payment)) {
        pendingCardAmount += amount
      } else if (isInvestmentCategory(payment.category)) {
        investmentFixed += amount
      } else if (!fixedNames.has(payment.category ?? '')) {
        // 固定費は budget.fixed.unpaid で数えるので、ここでは二重計上しない
        scheduledExpenses += amount
      }
    }

    // 今月すでに投資に回した額（買付のみ）
    const alreadyInvested = (investmentRes.data ?? [])
      .filter(tx => tx.side === 'buy' || tx.side === '買付')
      .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0)

    // 防衛資金。生活固定費は積立投資を除いた額で見る
    const livingFixed = Math.max(budget.fixed.effective - investmentFixed, 0)
    const emergencyFund = computeEmergencyFund({
      monthlyEssentialExpenses: essentialMonthlyExpenses({
        livingFixed,
        variableBudget: budget.variable.budget,
      }),
      currentLiquidCash: availableCash,
      targetMonths: Number(profileRes.data?.emergency_fund_months ?? 3),
    })

    const capacity = computeInvestmentCapacity({
      month,
      availableCash,
      expectedIncome,
      confirmedIncome: budget.income.actual,
      confirmedExpenses: budget.variable.spent,
      pendingCardAmount,
      fixedExpenses: budget.fixed.unpaid,
      scheduledExpenses,
      livingReserve: Math.max(0, budget.variable.remaining),
      buffer: budget.buffer,
      alreadyInvested,
      // 配分の優先順: 防衛資金の補充 → 貯蓄目標 → 投資目標 → 自由
      reserveGap: emergencyFund.reserveGap ?? 0,
      savingsTarget: budget.savings.target,
      investmentTarget: budget.investment.target,
      missingData,
    })

    return Response.json({
      ...capacity,
      // 算出時刻は純関数の外（I/O境界）で付ける。既存レスポンスとの互換のため維持する
      calculated_at: new Date().toISOString(),
      emergency_fund: emergencyFund,
      // 家計側の「今月あといくら使えるか」もそのまま渡す
      living: {
        variable_budget: budget.variable.budget,
        spent: budget.variable.spent,
        remaining: budget.variable.remaining,
        days_left: budget.variable.daysLeft,
        daily_allowance: budget.variable.dailyAllowance,
        pace: budget.variable.pace,
      },
      balance_recorded_at: liquidCash.recordedAt,
      liquid_cash_source: liquidCash.source,
      source: budgetLoad.source,
    })
  } catch (error) {
    // DBやライブラリの詳細をクライアントへ返さない（詳細はサーバーログへ）
    return readFailed('api/integrations/investment-capacity', error)
  }
}
