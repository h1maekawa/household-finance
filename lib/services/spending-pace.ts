// lib/services/spending-pace.ts
//
// 変動費の使用ペースの判定。純関数。
//
// しきい値をUIへ書くと、Home / Coach / 別画面で違う判定になる。
// 「使いすぎ」の 1.15 は budget-engine の警告ルールと同じ値にそろえている。
export type SpendingPaceState = 'ok' | 'fast' | 'over'

/** 経過日数比に対する消費ペース。1.0 が理想どおり */
export const PACE_FAST = 1.0
export const PACE_OVER = 1.15

export const SPENDING_PACE_LABEL: Record<SpendingPaceState, string> = {
  ok: '順調',
  fast: 'やや速い',
  over: '使いすぎ',
}

export function getSpendingPaceState(pace: number): SpendingPaceState {
  if (!Number.isFinite(pace)) return 'ok'
  if (pace > PACE_OVER) return 'over'
  if (pace > PACE_FAST) return 'fast'
  return 'ok'
}
