// lib/services/liquid-cash.ts
//
// Flow+ の「流動現金」の唯一の集計元。
//
// Dashboard / Assets / Investment Capacity / Emergency Fund が別々に
// 現金を数えると必ず数字がズレるので、ここへ集約する。
//
// 優先順位:
//   1. accounts + 各口座の最新 account_balances（複数口座を合計）
//   2. 無ければ legacy の account_balance の最新1件
//   3. どちらも無ければ null（0円と未登録を混同しない）
import { yen } from './money'

/** 流動現金に含める口座種別。証券口座は投資資産なので含めない */
export const LIQUID_ACCOUNT_TYPES = ['bank', 'cash', 'emoney'] as const

export type LiquidCash = {
  /** 合計。未登録なら null */
  amount: number | null
  source: 'accounts' | 'legacy_balance' | 'none'
  /** 最新の記録時刻。鮮度の判定に使う */
  recordedAt: string | null
  accountCount: number
}

export type AccountBalanceRow = {
  account_id: string
  balance: number | null
  recorded_at: string
}

export type AccountRow = { id: string; type: string }

/**
 * 口座と残高スナップショットから流動現金を合計する純関数。
 *
 * 残高が一度も記録されていない口座は 0円として数えない。数えると
 * 「残高データがある」と誤判定して、実態より少ない現金で計算してしまう。
 */
export function sumLiquidCash(
  accounts: AccountRow[],
  balances: AccountBalanceRow[]
): { amount: number | null; recordedAt: string | null; accountCount: number } {
  const liquidIds = new Set(
    accounts
      .filter(a => (LIQUID_ACCOUNT_TYPES as readonly string[]).includes(a.type))
      .map(a => a.id)
  )
  if (liquidIds.size === 0) return { amount: null, recordedAt: null, accountCount: 0 }

  // 口座ごとに最新の1件だけ採用する
  const latest = new Map<string, AccountBalanceRow>()
  for (const row of [...balances].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))) {
    if (!liquidIds.has(row.account_id)) continue
    if (latest.has(row.account_id)) continue
    if (row.balance === null || row.balance === undefined) continue
    latest.set(row.account_id, row)
  }
  if (latest.size === 0) return { amount: null, recordedAt: null, accountCount: liquidIds.size }

  let total = 0
  let recordedAt: string | null = null
  for (const row of latest.values()) {
    total += yen(row.balance ?? 0)
    if (!recordedAt || row.recorded_at > recordedAt) recordedAt = row.recorded_at
  }
  return { amount: total, recordedAt, accountCount: latest.size }
}
