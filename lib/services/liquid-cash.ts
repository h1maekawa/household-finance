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
  /** 最も古い口座の記録時刻。1口座でも古ければ鮮度が落ちるので、こちらで判定する */
  oldestRecordedAt: string | null
  /** 流動口座ごとの最新記録時刻。未記録の口座は null */
  accounts: { accountId: string; recordedAt: string | null }[]
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
 * 残高が一度も記録されていない口座が1つでもあれば合計しない（amount = null）。
 * 0円として数えると、また一部の口座だけで合計すると、実態より少ない現金で
 * 「残高データがある」と誤判定してしまう。
 */
export function sumLiquidCash(
  accounts: AccountRow[],
  balances: AccountBalanceRow[]
): Pick<LiquidCash, 'amount' | 'recordedAt' | 'oldestRecordedAt' | 'accounts' | 'accountCount'> {
  const liquidIds = accounts
    .filter(a => (LIQUID_ACCOUNT_TYPES as readonly string[]).includes(a.type))
    .map(a => a.id)
  if (liquidIds.length === 0) {
    return { amount: null, recordedAt: null, oldestRecordedAt: null, accounts: [], accountCount: 0 }
  }
  const liquidSet = new Set(liquidIds)

  // 口座ごとに最新の1件だけ採用する
  const latest = new Map<string, AccountBalanceRow>()
  for (const row of [...balances].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))) {
    if (!liquidSet.has(row.account_id)) continue
    if (latest.has(row.account_id)) continue
    if (row.balance === null || row.balance === undefined) continue
    latest.set(row.account_id, row)
  }

  const perAccount = liquidIds.map(id => ({
    accountId: id,
    recordedAt: latest.get(id)?.recorded_at ?? null,
  }))

  if (latest.size < liquidIds.length) {
    return {
      amount: null,
      recordedAt: null,
      oldestRecordedAt: null,
      accounts: perAccount,
      accountCount: liquidIds.length,
    }
  }

  let total = 0
  let newest: string | null = null
  let oldest: string | null = null
  for (const row of latest.values()) {
    total += yen(row.balance ?? 0)
    if (!newest || row.recorded_at > newest) newest = row.recorded_at
    if (!oldest || row.recorded_at < oldest) oldest = row.recorded_at
  }
  return {
    amount: total,
    recordedAt: newest,
    oldestRecordedAt: oldest,
    accounts: perAccount,
    accountCount: latest.size,
  }
}
