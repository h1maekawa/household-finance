import { balanceDateKey } from './capacity-obligations'
import { judgeBalanceFreshness } from './investment-capacity'

export const NO_SHORTFALL_PLAIN = '現時点では不足見込みなし'

/**
 * 30日予測は今日から始まるため、残高記録日〜今日の引落は予測に入っていない。
 * 最も古い口座の記録日が今日より前なら「不足なし」と断定せず、注意書きを返す。
 * today は JST の 'YYYY-MM-DD'。
 */
export function noShortfallMessage(input: { oldestRecordedAt: string | null; today: string }): string {
  if (!input.oldestRecordedAt) {
    return '不足見込みは検出されていません（残高記録日が不明で、記録日以降の引落が予測に未反映の可能性があるため、不足なしとは断定できません）'
  }
  const key = balanceDateKey(input.oldestRecordedAt)
  if (key >= input.today) return NO_SHORTFALL_PLAIN
  const [, m, d] = key.split('-')
  return `不足見込みは検出されていません（残高記録日 ${Number(m)}/${Number(d)} 以降の引落は予測に未反映のため、不足なしとは断定できません）`
}

export const SHORTFALL_STALE_MESSAGE = '口座残高が7日以上更新されていないため、資金繰りの不足を判定できません'

/**
 * 資金繰りの不足（残高がマイナスになる日）を判定してよいか。
 * 開始残高が既知 かつ 最も古い口座の記録が7日（168時間）以内のときだけ true。
 * 鮮度は投資可能額と同じ judgeBalanceFreshness で判定する（記録日時が不明なら false）。
 * false のときは「不足なし」と言わない（画面は SHORTFALL_STALE_MESSAGE、外部契約は known=false）。
 */
export function shortfallJudgeable(input: {
  balanceKnown: boolean
  oldestRecordedAt: string | null
  now: Date
}): boolean {
  if (!input.balanceKnown) return false
  return (
    judgeBalanceFreshness({ oldestRecordedAt: input.oldestRecordedAt, accountCount: 1, now: input.now }).freshness ===
    'current'
  )
}
