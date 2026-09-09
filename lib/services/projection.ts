// lib/services/projection.ts
//
// 将来資産の単純予測。純関数。
//
// MVP は利回り0%で固定する。
//
//   将来資産 = 現在資産 + 毎月の積立額 × 月数
//
// 期待リターンを載せた予測を「正式値」として出さない。将来追加する場合も
// scenario / assumption として、保証ではないことが分かる形にする。
import { yen } from './money'

export type ProjectionPoint = {
  years: number
  months: number
  /** 現在資産 + 積立の累計。利回りは見込まない */
  projectedAssets: number
  /** そのうち積立で増えた分 */
  contributed: number
}

export type ProjectionInput = {
  /** 現在の総資産。分からないなら null */
  currentAssets: number | null
  /** 毎月の積立額 */
  monthlyContribution: number
  /** 何年後を出すか */
  horizons?: number[]
}

export const DEFAULT_HORIZONS = [1, 3, 5, 10]

export function projectAssets(input: ProjectionInput): ProjectionPoint[] {
  if (input.currentAssets === null) return []

  const current = yen(input.currentAssets)
  const monthly = Math.max(yen(input.monthlyContribution), 0)
  const horizons = input.horizons ?? DEFAULT_HORIZONS

  return horizons.map(years => {
    const months = Math.round(years * 12)
    const contributed = monthly * months
    return { years, months, projectedAssets: current + contributed, contributed }
  })
}
