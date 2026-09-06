// lib/services/asset-value.ts
//
// 保有資産の評価額。純関数。
// 同じ評価ルールを画面ごとに書くと資産額がズレるので、ここだけに置く。

export type StockHoldingValue = {
  /** 証券会社が出している評価額。あればこれを正とする */
  broker_current_value?: number | null
  shares?: number | null
  average_cost?: number | null
}

/**
 * 株式の現在評価額。
 * 証券会社の評価額があればそれを使い、無ければ取得単価 × 株数で近似する。
 */
export function stockCurrentValue(holding: StockHoldingValue): number {
  const brokerValue = Number(holding.broker_current_value ?? 0)
  if (brokerValue > 0) return brokerValue
  return Number(holding.shares ?? 0) * Number(holding.average_cost ?? 0)
}
