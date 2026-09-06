// lib/services/asset-planning.ts
//
// 資産形成プランの Orchestration / Composition Layer。
//
// **ここは計算式の置き場所ではない。** 金額はすべて既存エンジンが出したものを
// 束ね直すだけで、新しい計算式を持たない。
//
//   budget-engine        収入・固定費・変動費・貯蓄/投資の目標
//   money-plan           お金の流れ（積立投資とカード請求の二重計上を避ける）
//   investment-capacity  再配分できる現金と、その配分
//   goal-progress        目標の逆算と達成見込み
//   emergency-fund       現金防衛資金
//   projection           将来資産の単純予測
//
// 例外は「必須生活費の組み立て」だけで、これも既存の値を足し合わせるだけ。
import type { BudgetSummary } from '@/types/budget'
import type { GoalProgress, GoalTrackStatus } from '@/types/goal'
import type { CapacityResult } from './investment-capacity'
import type { EmergencyFundResult } from './emergency-fund'
import type { ProjectionPoint } from './projection'
import { yen } from './money'

/** 既存 GoalTrackStatus の表示ラベル。新しい判定ロジックは作らない */
export const GOAL_STATUS_LABEL: Record<GoalTrackStatus, string> = {
  achieved: '達成済み',
  on_track: '達成可能',
  behind: 'やや不足',
  stalled: '大幅不足',
  unplanned: '入力不足',
}

export type AssetPlanGoal = {
  goalId: string
  title: string
  status: GoalTrackStatus
  statusLabel: string
  /** goal-progress が出した値をそのまま持つ。ここで逆算しない */
  requiredMonthly: number | null
  monthlyPace: number
  projectedAchievementMonth: string | null
  remainingAmount: number
}

export type AssetPlanningResult = {
  month: string
  cashflow: {
    /** 今月まだ使ってよい変動費。budget-engine が正 */
    freeToSpend: number
    dailyAllowance: number
    daysLeft: number
  }
  capacity: {
    /** 再配分できる現金。null は入力不足で算出不能 */
    allocatableCash: number | null
    savingCapacity: number | null
    assetBuildingCapacity: number | null
    freeCash: number | null
  }
  emergencyFund: EmergencyFundResult
  goals: AssetPlanGoal[]
  projection: ProjectionPoint[]
  confidence: CapacityResult['confidence']
  missingData: string[]
}

/**
 * 毎月の必須生活費。
 *
 * 新しい生活費の定義を作らず、既存の値を足すだけにする。
 *
 *   生活固定費（積立投資を除く）+ 変動費の予算枠
 *
 * 変動費のうち「必需の部分」を切り出す情報は現状のデータに無い。推測で
 * 小さくすると防衛資金を過小に見積もるので、変動費予算をそのまま使う
 * 安全側の見積りにする（不足していることは missingData で伝える）。
 */
export function essentialMonthlyExpenses(input: {
  livingFixed: number | null
  variableBudget: number
}): number | null {
  if (input.livingFixed === null) return null
  return yen(input.livingFixed) + Math.max(yen(input.variableBudget), 0)
}

export function buildAssetPlan(input: {
  month: string
  budget: BudgetSummary
  capacity: CapacityResult
  emergencyFund: EmergencyFundResult
  goals: GoalProgress[]
  projection: ProjectionPoint[]
}): AssetPlanningResult {
  const { month, budget, capacity, emergencyFund, goals, projection } = input

  // 各エンジンが報告した欠損をまとめるだけ。ここで独自の判定を足さない
  const missingData = [...capacity.missing_data]
  if (emergencyFund.status === 'unknown') {
    missingData.push('防衛資金の算出に必要な生活費または現金残高が不足しています')
  }
  if (budget.variable.budget <= 0) {
    missingData.push('変動費の予算が未設定のため、必須生活費を安全側に見積もれていません')
  }

  // confidence は investment-capacity の判定を正とする。
  // 独自ルールを作らず、防衛資金が出せないときだけ一段下げる
  const confidence: CapacityResult['confidence'] =
    emergencyFund.status === 'unknown' && capacity.confidence === 'high'
      ? 'medium'
      : capacity.confidence

  return {
    month,
    cashflow: {
      freeToSpend: yen(budget.variable.remaining),
      dailyAllowance: yen(budget.variable.dailyAllowance),
      daysLeft: budget.variable.daysLeft,
    },
    capacity: {
      allocatableCash: capacity.allocatable_cash,
      savingCapacity: capacity.saving_capacity,
      assetBuildingCapacity: capacity.asset_building_capacity,
      freeCash: capacity.free_cash,
    },
    emergencyFund,
    goals: goals.map(goal => ({
      goalId: goal.goalId,
      title: goal.title,
      status: goal.status,
      statusLabel: GOAL_STATUS_LABEL[goal.status],
      requiredMonthly: goal.requiredMonthly,
      monthlyPace: goal.monthlyPace,
      projectedAchievementMonth: goal.projectedAchievementMonth,
      remainingAmount: goal.remainingAmount,
    })),
    projection,
    confidence,
    missingData: [...new Set(missingData)],
  }
}
