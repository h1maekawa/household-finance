// lib/services/asset-planning-loader.ts
//
// 資産形成プランの収集(I/O)。
//
// **新しい金融式をここに書かない。** 各エンジンの入力を集めて渡し、
// 結果を buildAssetPlan へ束ねるだけ。計算は lib/services/*.ts の純関数にある。
//
// Integration 用 API とユーザー向け API で計算を複製しないよう、両方ここを通す。
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMergedCategories } from '@/lib/categories'
import { listGoals } from '@/lib/repositories/goals'
import { loadBudget, monthEnd, monthStart } from './budget-loader'
import { loadLiquidCash } from './liquid-cash-loader'
import { loadAssetSummary } from './asset-summary-loader'
import { computeEmergencyFund } from './emergency-fund'
import { computeGoalProgress } from './goal-progress'
import { computeInvestmentCapacity } from './investment-capacity'
import { buildMoneyPlan, isCardBillPayment, isInvestmentCategory } from './money-plan'
import { loadResolvedScheduledPayments } from './scheduled-payments-loader'
import { projectAssets } from './projection'
import {
  buildAssetPlan,
  essentialMonthlyExpenses,
  monthlyAssetContribution,
  type AssetPlanningResult,
} from './asset-planning'
import type { AssetSummary } from './asset-summary-loader'

export type AssetPlanningLoad = {
  plan: AssetPlanningResult
  assets: AssetSummary
}

export async function loadAssetPlanning(
  userId: string,
  month: string,
  today: string,
  client?: SupabaseClient
): Promise<AssetPlanningLoad> {
  const supabase = client
  const [budgetLoad, liquidCash, assets, scheduledRes, investmentRes, profileRes, goals, categories] =
    await Promise.all([
      loadBudget(userId, month, today, client),
      loadLiquidCash(userId, client),
      loadAssetSummary(userId, client),
      requireClient(supabase)
        .from('scheduled_payments')
        .select('name, amount, memo, type, is_active, category')
        .eq('user_id', userId)
        .eq('is_active', true),
      requireClient(supabase)
        .from('investment_transactions')
        .select('trade_date, amount, side')
        .eq('user_id', userId)
        .gte('trade_date', monthStart(month))
        .lte('trade_date', monthEnd(month)),
      requireClient(supabase)
        .from('users_profile')
        .select('emergency_fund_months')
        .eq('user_id', userId)
        .maybeSingle(),
      listGoals(userId, client),
      getMergedCategories(userId, client),
    ])
  const resolvedPayments = await loadResolvedScheduledPayments(userId, month, client)

  // 金融計算では「DB取得失敗 = 0円」にしない。欠損のまま計算すると
  // 未払い予定が0円になり、配分できる現金が実態より大きく出る
  for (const [label, res] of [
    ['scheduled_payments', scheduledRes],
    ['investment_transactions', investmentRes],
    ['users_profile', profileRes],
  ] as const) {
    if (res.error) throw new Error(`${label} の取得に失敗しました: ${res.error.message}`)
  }

  const budget = budgetLoad.summary
  const missingData: string[] = []
  if (liquidCash.amount === null) missingData.push('口座残高が未登録です')
  if (budget.income.planned === 0) missingData.push('月収の設定がありません')

  const fixedNames = new Set(categories.fixedNames)
  let pendingCardAmount = 0
  let scheduledExpenses = 0
  let investmentFixed = 0
  for (const payment of scheduledRes.data ?? []) {
    const amount = Number(payment.amount) || 0
    if (isCardBillPayment(payment)) {
      pendingCardAmount += amount
    } else if (isInvestmentCategory(payment.category)) {
      // 積立投資は生活固定費ではない。防衛資金の必要額へ含めない
      investmentFixed += amount
    } else if (!fixedNames.has(payment.category ?? '')) {
      // 固定費は budget.fixed.unpaid で数えるので二重計上しない
      scheduledExpenses += amount
    }
  }

  const alreadyInvested = (investmentRes.data ?? [])
    .filter(tx => tx.side === 'buy' || tx.side === '買付')
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0)

  const emergencyFund = computeEmergencyFund({
    monthlyEssentialExpenses: essentialMonthlyExpenses({
      livingFixed: Math.max(budget.fixed.effective - investmentFixed, 0),
      variableBudget: budget.variable.budget,
    }),
    currentLiquidCash: liquidCash.amount,
    targetMonths: Number(profileRes.data?.emergency_fund_months ?? 3),
  })

  const capacity = computeInvestmentCapacity({
    month,
    availableCash: liquidCash.amount,
    expectedIncome: Math.max(0, budget.income.planned - budget.income.actual),
    confirmedIncome: budget.income.actual,
    confirmedExpenses: budget.variable.spent,
    pendingCardAmount,
    fixedExpenses: budget.fixed.unpaid,
    scheduledExpenses,
    livingReserve: Math.max(0, budget.variable.remaining),
    buffer: budget.buffer,
    alreadyInvested,
    reserveGap: emergencyFund.reserveGap ?? 0,
    savingsTarget: budget.savings.target,
    investmentTarget: budget.investment.target,
    missingData,
  })

  const goalProgress = goals
    .filter(goal => goal.status !== 'paused')
    .map(goal => computeGoalProgress(goal, { asOf: today }))

  return {
    plan: buildAssetPlan({
      month,
      // お金の流れはサーバーで組み立てる。以前は画面側で buildMoneyPlan を
      // 呼んでおり、UIに金融計算が乗っていた
      moneyPlan: buildMoneyPlan({
        month,
        budget,
        categoryBudgets: budgetLoad.categoryBudgets,
        fixedPayments: resolvedPayments,
        goals: goalProgress,
      }),
      budget,
      capacity,
      emergencyFund,
      goals: goalProgress,
      // 将来予測は総資産が起点。現金だけを渡すと資産推移が実態より低く出る
      projection: projectAssets({
        currentAssets: assets.totalAssets,
        monthlyContribution: monthlyAssetContribution(capacity) ?? 0,
      }),
    }),
    assets,
  }
}

/** loadBudget と違いこちらはクライアント必須。呼び出し側の渡し忘れを型で防げないため明示する */
function requireClient(client?: SupabaseClient): SupabaseClient {
  if (!client) {
    throw new Error('loadAssetPlanning には Supabase クライアントを渡してください')
  }
  return client
}
