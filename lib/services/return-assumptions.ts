// lib/services/return-assumptions.ts
//
// 想定利回りの「仮定」。純関数。
//
// FIRE Planner と Scenario Engine の両方が同じ利回りの前提を使うので、
// 定義はここだけに置く。どちらかに書き写すと、片方だけ 3% が 4% になる。
//
// **利回りはすべて仮定であり、保証ではない。** 「確実に」「必ず」のような
// 表現を使う画面をここから作らないこと。

/** 正式シナリオ（スペック §22 / §3）。これ以外は Custom Scenario として扱う */
export const OFFICIAL_RETURN_RATES = [0, 0.03, 0.05, 0.07] as const

/** FIRE の必要資産で使う既定の想定利回り。いわゆる4%ルールに合わせた仮定 */
export const DEFAULT_RETURN_RATE = 0.04

export function isOfficialReturnRate(rate: number): boolean {
  return OFFICIAL_RETURN_RATES.some(official => official === rate)
}

/**
 * 年利から月利。月次複利で回すための素の割り算で、これ以上の近似はしない。
 * 負の利回りは扱わない（0へ丸める）。
 */
export function monthlyRateFrom(annualReturnRate: number): number {
  if (!Number.isFinite(annualReturnRate) || annualReturnRate <= 0) return 0
  return annualReturnRate / 12
}
