// lib/services/goal-milestone.ts
//
// 目標のマイルストーン（スペック §19）。純関数。
//
// 3,000万円のような目標は、そのままでは距離が分からない。途中の通過点へ
// 分割して「次はどこか」「そこまであといくらか」を出す。
//
// 目標そのものの逆算（必要月額・達成予定月・進捗率）は goal-progress.ts が正。
// ここでは同じ計算を作らず、通過点の判定と次の通過点までの距離だけを扱う。
import type { GoalMilestone } from '@/types/goal'
import { addMonthsToMonth } from './goal-progress'
import { safeRatio, yen } from './money'

export type MilestoneProgress = {
  id: string
  amount: number
  /** 呼び名。未設定なら null（画面が金額から作る） */
  label: string | null
  reached: boolean
  /** 直前の通過点（無ければ0円）からこの通過点までの進捗 0〜1 */
  segmentProgress: number
  /** この通過点までの残額。到達済みなら0 */
  remainingAmount: number
}

export type MilestoneTrack = {
  currentAmount: number
  milestones: MilestoneProgress[]
  reachedCount: number
  /** 次に目指す通過点。すべて到達済みなら null */
  nextMilestone: MilestoneProgress | null
  /** 次の通過点までの残額。すべて到達済みなら null */
  remainingToNext: number | null
  /**
   * 現在の積立ペースで次の通過点へ到達する月 'YYYY-MM'。
   * 利回り0%の単純積立（既存 projection と同じ前提）。
   */
  projectedNextMonth: string | null
}

export function buildMilestoneTrack(input: {
  /** 目標に紐づく現在額。goal-progress と同じ値を渡す */
  currentAmount: number
  milestones: GoalMilestone[]
  /** 毎月の積立ペース（円/月） */
  monthlyPace: number
  /** 'YYYY-MM' */
  asOfMonth: string
}): MilestoneTrack {
  const currentAmount = yen(input.currentAmount)
  // DB側で金額の昇順に position を振っているが、経路が増えても崩れないよう
  // ここでも並べ直す
  const sorted = [...input.milestones].sort((a, b) => a.amount - b.amount)

  let previous = 0
  const milestones: MilestoneProgress[] = sorted.map(milestone => {
    const amount = yen(milestone.amount)
    const span = amount - previous
    const progressed = currentAmount - previous
    const segmentProgress =
      span <= 0 ? (currentAmount >= amount ? 1 : 0) : Math.min(Math.max(safeRatio(progressed, span), 0), 1)
    previous = amount
    return {
      id: milestone.id,
      amount,
      label: milestone.label,
      reached: currentAmount >= amount,
      segmentProgress: Math.round(segmentProgress * 1000) / 1000,
      remainingAmount: Math.max(amount - currentAmount, 0),
    }
  })

  const nextMilestone = milestones.find(m => !m.reached) ?? null
  const pace = Math.max(yen(input.monthlyPace), 0)

  return {
    currentAmount,
    milestones,
    reachedCount: milestones.filter(m => m.reached).length,
    nextMilestone,
    remainingToNext: nextMilestone ? nextMilestone.remainingAmount : null,
    projectedNextMonth:
      nextMilestone === null
        ? null
        : pace <= 0
          ? null
          : addMonthsToMonth(input.asOfMonth, Math.ceil(nextMilestone.remainingAmount / pace)),
  }
}

/** 候補の刻み幅を 1 / 2 / 5 × 10^n に丸める。中途半端な数字を通過点にしない */
function roundToNiceStep(value: number): number {
  if (value <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const multiple of [1, 2, 5]) {
    if (value <= magnitude * multiple) return magnitude * multiple
  }
  return magnitude * 10
}

/**
 * 通過点の **候補** を作る（スペック §19）。
 *
 * これは提案であって確定ではない。保存するのはユーザーが確定したときだけで、
 * システムが勝手に通過点を作って保存しない（支出価値タグと同じ扱い）。
 *
 * 目標額・現在額が使えないときは空配列を返す（推測で埋めない）。
 */
export function suggestMilestoneAmounts(
  targetAmount: number | null,
  currentAmount: number,
  steps = 5
): number[] {
  if (targetAmount === null) return []
  const target = yen(targetAmount)
  const current = Math.max(yen(currentAmount), 0)
  if (target <= 0 || target <= current) return []

  const step = roundToNiceStep((target - current) / Math.max(steps, 1))
  if (step <= 0) return []

  const amounts: number[] = []
  // 現在額のすぐ上のキリのいい額から刻む
  let amount = (Math.floor(current / step) + 1) * step
  while (amount < target && amounts.length < 11) {
    amounts.push(amount)
    amount += step
  }
  amounts.push(target)

  return [...new Set(amounts)].sort((a, b) => a - b)
}
