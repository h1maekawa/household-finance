// lib/services/money.ts
// 「お金の型は整数円で統一」(docs/v3-architecture-review.md §2 判断B)。
// 家計アプリで浮動小数の丸め事故は信用を失うので、円は必ずここを通して整数化する。

/** 任意の入力を整数円にする。数値でなければ fallback。 */
export function yen(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(parsed)
}

/** 負の値を 0 に丸めた整数円。予算枠など「マイナスがありえない」値に使う。 */
export function nonNegativeYen(value: unknown, fallback = 0): number {
  return Math.max(yen(value, fallback), 0)
}

/**
 * total を weights の比率で整数円に配分する。
 * 端数は最大剰余法(largest remainder)で配り、合計が必ず total と一致するようにする。
 * 単純な四捨五入だと合計がズレて「配分の合計 ≠ 自由予算」になり、UIで破綻する。
 */
export function allocateByRatio(
  total: number,
  weights: Record<string, number>
): Record<string, number> {
  const entries = Object.entries(weights).filter(([, w]) => Number.isFinite(w) && w > 0)
  if (entries.length === 0) return {}

  const target = yen(total)
  if (target <= 0) return Object.fromEntries(entries.map(([key]) => [key, 0]))

  const weightSum = entries.reduce((sum, [, w]) => sum + w, 0)
  const exact = entries.map(([key, w]) => ({ key, value: (target * w) / weightSum }))

  const floored = exact.map(e => ({ ...e, floor: Math.floor(e.value) }))
  let remainder = target - floored.reduce((sum, e) => sum + e.floor, 0)

  const byRemainder = [...floored].sort(
    (a, b) => (b.value - b.floor) - (a.value - a.floor)
  )
  const result: Record<string, number> = {}
  for (const e of floored) result[e.key] = e.floor
  for (const e of byRemainder) {
    if (remainder <= 0) break
    result[e.key] += 1
    remainder -= 1
  }

  return result
}

/** 0 除算を避ける割合計算。分母が 0 以下なら fallback。 */
export function safeRatio(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return fallback
  return numerator / denominator
}
