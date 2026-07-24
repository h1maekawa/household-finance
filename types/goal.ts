// types/goal.ts — ライフゴールと進捗の契約。

export type GoalKind =
  | 'fire'
  | 'house'
  | 'car'
  | 'education'
  | 'savings'
  | 'travel'
  | 'custom'

export type GoalStatus = 'active' | 'achieved' | 'paused'

export type LifeGoal = {
  id: string
  kind: GoalKind
  title: string
  target_amount: number | null
  target_date: string | null // YYYY-MM-DD
  current_amount: number
  priority: number
  monthly_contribution: number | null
  status: GoalStatus
  assumptions?: Record<string, unknown> | null
}

export type GoalInput = {
  kind?: GoalKind
  title: string
  target_amount?: number | null
  target_date?: string | null
  current_amount?: number
  priority?: number
  monthly_contribution?: number | null
  status?: GoalStatus
}

/** 予測の健全性。MVP は「単純積立・名目」(利回り・インフレを見込まない) */
export type GoalTrackStatus = 'achieved' | 'on_track' | 'behind' | 'stalled' | 'unplanned'

export type GoalProgress = {
  goalId: string
  title: string
  kind: GoalKind
  targetAmount: number | null
  currentAmount: number
  remainingAmount: number
  /** 0〜1(超過しても 1 で頭打ちにはしない) */
  progressRate: number
  /** 目標日までに必要な毎月の積立額 */
  requiredMonthly: number | null
  /** 直近の実績から見た毎月の積立ペース */
  monthlyPace: number
  /** 現在のペースでの達成予測月 'YYYY-MM'。到達しないなら null */
  projectedAchievementMonth: string | null
  /** 目標日までの残り月数 */
  monthsToTarget: number | null
  status: GoalTrackStatus
}
