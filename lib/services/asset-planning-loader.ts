// lib/services/asset-planning-loader.ts
//
// 資産形成プランの収集(I/O)。
//
// **新しい金融式をここに書かない。** 各エンジンの入力を集めて渡し、
// 結果を buildAssetPlan へ束ねるだけ。計算は lib/services/*.ts の純関数にある。
//
// Integration 用 API とユーザー向け API で計算を複製しないよう、両方ここを通す。
import type { SupabaseClient } from '@supabase/supabase-js'
import { listGoals } from '@/lib/repositories/goals'
import { loadAssetSummary } from './asset-summary-loader'
import { computeGoalProgress } from './goal-progress'
import { computeInvestmentCapacity } from './investment-capacity'
import { buildMoneyPlan } from './money-plan'
import { loadCapacityInput } from './capacity-input'
import { projectAssets } from './projection'
import {
  buildAssetPlan,
  monthlyAssetContribution,
  type AssetPlanningResult,
} from './asset-planning'
import type { AssetSummary } from './asset-summary-loader'
import type { BudgetSummary } from '@/types/budget'

export type AssetPlanningLoad = {
  plan: AssetPlanningResult
  assets: AssetSummary
  /** Integration でも同じ budget-engine の結果を再利用できるように返す */
  budget: BudgetSummary
}

export async function loadAssetPlanning(
  userId: string,
  month: string,
  today: string,
  client?: SupabaseClient
): Promise<AssetPlanningLoad> {
  // 投資可能額の入力は Integration API と同じ loadCapacityInput を通す（数字を揃える）
  const [capacityLoad, assets, goals] = await Promise.all([
    loadCapacityInput(userId, month, new Date(), requireClient(client)),
    loadAssetSummary(userId, client),
    listGoals(userId, client),
  ])
  const { context, ...capacityInput } = capacityLoad
  const budgetLoad = context.budgetLoad
  const budget = budgetLoad.summary
  const resolvedPayments = context.resolvedPayments
  const emergencyFund = context.emergencyFund
  const capacity = computeInvestmentCapacity(capacityInput)

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
    budget,
  }
}

/** loadBudget と違いこちらはクライアント必須。呼び出し側の渡し忘れを型で防げないため明示する */
function requireClient(client?: SupabaseClient): SupabaseClient {
  if (!client) {
    throw new Error('loadAssetPlanning には Supabase クライアントを渡してください')
  }
  return client
}
