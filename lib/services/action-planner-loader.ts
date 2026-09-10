// lib/services/action-planner-loader.ts
//
// 「今月やること」の収集(I/O)。
//
// **新しい金融式をここに書かない。** 既存の Loader / エンジンが出した結果を
// 集めて action-planner の純関数へ渡すだけ。
//
//   asset-planning   配分・防衛資金・設定不足
//   coach-context    支出超過・引落不足・払い漏れ・目標不足の判定
//   cashflow         残高がマイナスになる日・未割当のカード利用
//   transactions     カテゴリ未確定の件数
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAssetPlanning } from './asset-planning-loader'
import { loadCoachInputs, monthEnd, monthStart } from './budget-loader'
import { buildCoachContext } from './coach-context'
import { buildCoachInsights } from './coach-rules'
import { loadCashflow } from './cashflow-loader'
import { buildMonthlyActions, type MonthlyAction } from './action-planner'

export type ActionPlanLoad = {
  month: string
  actions: MonthlyAction[]
}

export async function loadMonthlyActions(
  userId: string,
  month: string,
  today: string,
  client: SupabaseClient
): Promise<ActionPlanLoad> {
  const [assetPlanning, coachInputs, cashflow, uncategorizedRes] = await Promise.all([
    loadAssetPlanning(userId, month, today, client),
    loadCoachInputs(userId, month, today),
    loadCashflow(userId, client),
    client
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('needs_review', true)
      .gte('date', monthStart(month))
      .lte('date', monthEnd(month)),
  ])

  // 件数の取得失敗を0件として扱うと「確認するものは無い」と誤って言うことになる
  if (uncategorizedRes.error) {
    throw new Error(`transactions の取得に失敗しました: ${uncategorizedRes.error.message}`)
  }

  const context = buildCoachContext({
    today,
    budgetInput: coachInputs.budget.input,
    categoryBudgets: coachInputs.budget.categoryBudgetMap,
    goals: coachInputs.goals,
    accounts: coachInputs.accounts,
    upcomingDebits: coachInputs.upcomingDebits,
  })

  const negativeDay = cashflow.projectedDays.find(day => day.isNegative) ?? null

  return {
    month,
    actions: buildMonthlyActions({
      month,
      plan: assetPlanning.plan,
      // 判定は既存 coach-rules。ここで作り直さない
      insights: buildCoachInsights(context),
      categoryProgress: context.categoryProgress,
      uncategorizedCount: uncategorizedRes.count ?? 0,
      unassignedCardUsage: cashflow.unassignedCardUsage
        ? {
            count: cashflow.unassignedCardUsage.count,
            total: cashflow.unassignedCardUsage.total,
          }
        : null,
      firstNegativeDay: negativeDay
        ? { date: negativeDay.date, balance: negativeDay.balance }
        : null,
    }),
  }
}
