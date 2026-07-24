// lib/services/goal-progress.ts
//
// 目標の逆算と達成予測。全て決定的な純関数(スペック §3 Phase5)。
// 「このままなら2030年11月に達成予定」は線形予測で出せるので LLM は不要。
//
// MVP の前提(スペック §7-1): **単純積立・名目**。利回り・インフレは見込まない。
// 投資評価額を目標額にカウントするかは呼び出し側が currentAmount の作り方で決める。
import type { GoalProgress, GoalTrackStatus, LifeGoal } from '@/types/goal'
import { nonNegativeYen, safeRatio, yen } from './money'

/** from 月から to 月までの月数(同月なら 0)。'YYYY-MM' でも 'YYYY-MM-DD' でも可。 */
export function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)
  if (!fromYear || !fromMonth || !toYear || !toMonth) return 0
  return (toYear - fromYear) * 12 + (toMonth - fromMonth)
}

/** asOf から monthsAhead ヶ月後の 'YYYY-MM' */
export function addMonthsToMonth(from: string, monthsAhead: number): string {
  const [year, month] = from.split('-').map(Number)
  const zeroBased = (year * 12 + (month - 1)) + monthsAhead
  const resultYear = Math.floor(zeroBased / 12)
  const resultMonth = (zeroBased % 12) + 1
  return `${resultYear}-${String(resultMonth).padStart(2, '0')}`
}

/**
 * 目標日までに必要な毎月の積立額。
 *   (target_amount − 現在額) / 残り月数
 * 目標額・目標日が無い、または目標日を過ぎているなら null。
 */
export function requiredMonthlyContribution(
  goal: Pick<LifeGoal, 'target_amount' | 'target_date' | 'current_amount'>,
  asOf: string
): number | null {
  if (!goal.target_amount || !goal.target_date) return null
  const remaining = yen(goal.target_amount) - yen(goal.current_amount)
  if (remaining <= 0) return 0

  // 目標月の月末までに貯めればよいので、当月も積立月に数える。
  const months = monthsBetween(asOf, goal.target_date) + 1
  if (months <= 0) return null
  return Math.ceil(remaining / months)
}

function trackStatus(
  progress: Omit<GoalProgress, 'status'>,
  toleranceRatio: number
): GoalTrackStatus {
  if (progress.targetAmount === null) return 'unplanned'
  if (progress.remainingAmount <= 0) return 'achieved'
  if (progress.monthlyPace <= 0) return 'stalled'
  if (progress.requiredMonthly === null) return 'unplanned'
  return progress.monthlyPace >= progress.requiredMonthly * toleranceRatio
    ? 'on_track'
    : 'behind'
}

export function computeGoalProgress(
  goal: LifeGoal,
  options: {
    /** 'YYYY-MM-DD' または 'YYYY-MM' */
    asOf: string
    /** 直近実績から見た毎月の積立ペース(円/月) */
    monthlyPace?: number
    /** on_track と判定する許容率(既定 0.9 = 必要額の9割出ていれば順調) */
    toleranceRatio?: number
  }
): GoalProgress {
  const asOfMonth = options.asOf.slice(0, 7)
  const targetAmount = goal.target_amount === null ? null : yen(goal.target_amount)
  const currentAmount = yen(goal.current_amount)
  const remainingAmount = targetAmount === null ? 0 : Math.max(targetAmount - currentAmount, 0)

  const requiredMonthly = requiredMonthlyContribution(goal, asOfMonth)
  const monthlyPace = nonNegativeYen(
    options.monthlyPace ?? goal.monthly_contribution ?? 0
  )

  let projectedAchievementMonth: string | null = null
  if (targetAmount !== null) {
    if (remainingAmount <= 0) {
      projectedAchievementMonth = asOfMonth
    } else if (monthlyPace > 0) {
      projectedAchievementMonth = addMonthsToMonth(
        asOfMonth,
        Math.ceil(remainingAmount / monthlyPace)
      )
    }
  }

  const base: Omit<GoalProgress, 'status'> = {
    goalId: goal.id,
    title: goal.title,
    kind: goal.kind,
    targetAmount,
    currentAmount,
    remainingAmount,
    progressRate:
      targetAmount === null
        ? 0
        : Math.round(safeRatio(currentAmount, targetAmount) * 1000) / 1000,
    requiredMonthly,
    monthlyPace,
    projectedAchievementMonth,
    monthsToTarget: goal.target_date ? monthsBetween(asOfMonth, goal.target_date) : null,
  }

  return {
    ...base,
    status:
      goal.status === 'achieved'
        ? 'achieved'
        : trackStatus(base, options.toleranceRatio ?? 0.9),
  }
}

/**
 * 目標に紐づく積立の実績ペース(円/月)。
 * MVP は「対象期間の入金合計 / 月数」の単純平均(スペック §2.6)。
 */
export function monthlyPaceFrom(
  contributions: Array<{ date: string; amount: number }>,
  options: { fromMonth: string; toMonth: string }
): number {
  const months = Math.max(monthsBetween(options.fromMonth, options.toMonth) + 1, 1)
  const total = contributions
    .filter(c => {
      const month = c.date.slice(0, 7)
      return month >= options.fromMonth && month <= options.toMonth
    })
    .reduce((sum, c) => sum + yen(c.amount), 0)
  return Math.max(Math.round(total / months), 0)
}

/** ダッシュボードに出す「主目標」。priority 降順 → 目標日が近い順。 */
export function pickPrimaryGoal(goals: LifeGoal[]): LifeGoal | null {
  const active = goals.filter(goal => goal.status === 'active')
  if (active.length === 0) return null
  return [...active].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    if (a.target_date && b.target_date) return a.target_date < b.target_date ? -1 : 1
    if (a.target_date) return -1
    if (b.target_date) return 1
    return a.title < b.title ? -1 : 1
  })[0]
}
