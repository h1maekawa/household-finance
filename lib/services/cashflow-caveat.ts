import { balanceDateKey } from './capacity-obligations'

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
