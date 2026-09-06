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
  /** 再配分できる現金。null は入力不足で算出不能 */
  allocatableCash: number | null
  /**
   * 今月のお金の配分。合計は必ず max(allocatableCash, 0) と一致する。
   * emergencyFund は「手元の現金の振り替え」で、毎月の積立ではない。
   */
  allocation: {
    emergencyFund: number | null
    savings: number | null
    assetBuilding: number | null
    unallocatedCash: number | null
  }
  /**
   * 将来予測に使う毎月の積立額 = 通常貯金 + 資産形成。
   * 防衛資金は既存現金の振り替えなので含めない。
   */
  monthlyAssetContribution: number | null
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
/**
 * 将来予測に使う毎月の積立額。
 *
 * 通常貯金 + 資産形成。防衛資金は手元の現金を振り替えるだけで毎月増えるもの
 * ではないので含めない。式をここで作らず、配分結果を足すだけにする。
 */
export function monthlyAssetContribution(capacity: CapacityResult): number | null {
  const { savings, asset_building } = capacity.allocation
  if (savings === null || asset_building === null) return null
  return savings + asset_building
}

export function essentialMonthlyExpenses(input: {
  livingFixed: number | null
  variableBudget: number
}): number | null {
  if (input.livingFixed === null) return null
  const total = yen(input.livingFixed) + Math.max(yen(input.variableBudget), 0)
  // 「本当に生活費0円」ではなく「予算が未設定」の可能性が高い。
  // 0円を返すと必要額0円=充足済みと表示され、設定漏れが安全な状態に見える
  return total > 0 ? total : null
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
    allocatableCash: capacity.allocatable_cash,
    allocation: {
      emergencyFund: capacity.allocation.emergency_fund,
      savings: capacity.allocation.savings,
      assetBuilding: capacity.allocation.asset_building,
      unallocatedCash: capacity.allocation.unallocated_cash,
    },
    monthlyAssetContribution: monthlyAssetContribution(capacity),
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
