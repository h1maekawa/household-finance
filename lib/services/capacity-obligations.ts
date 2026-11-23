// lib/services/capacity-obligations.ts
//
// 投資可能額の入力のうち「これから出ていく／入ってくるお金」を決める純関数。
// I/O（loadCapacityInput）は capacity-input.ts にあり、ここは DB に触れない
// （node --test から直接読めるよう、Supabase を読み込むモジュールを import しない）。
//
// 中心の規則（global-constraints「残高に反映済みの支払いを二重に差し引かない」）:
//   口座残高の記録日より前に引き落とされた支払いは、残高に反映済みなので差し引かない。
//   記録日と同じ日のものは反映済みか分からないので、支払いは差し引き、入金は足さない。
//   引落口座が分かるものはその口座の記録日、分からないものは最も古い記録日で判定する。
import { parseISO } from 'date-fns'
import { buildCardCycles, type CardCycle } from '@/lib/cashflow'
import { isCardBillPayment, isInvestmentCategory } from './money-plan'
import { summarizeVariableSpendingInRange } from './budget-engine'
import { LIVING_BUFFER_WINDOW_DAYS } from './living-buffer'
import type { CreditCardSetting, ResolvedScheduledPayment } from '@/types/cashflow'
import type { Transaction } from '@/types/transaction'
import type { BudgetTransaction } from '@/types/budget'

/** カードサイクル・90日バッファの両方に使う取引の取得日数（今日を含む） */
export const CAPACITY_TRANSACTION_FETCH_DAYS = 120

export type ObligationItem = {
  label: string
  amount: number
  kind: 'card' | 'fixed' | 'scheduled' | 'income'
}

export type Obligations = {
  cardUnpaid: number
  fixedUnpaid: number
  scheduledUnpaid: number
  expectedIncome: number
  items: ObligationItem[]
}

export type ObligationsInput = {
  /** 今日 'YYYY-MM-DD'（日本時間） */
  today: string
  /** 対象月の末日 'YYYY-MM-DD' */
  monthEnd: string
  scheduled: ResolvedScheduledPayment[]
  cardCycles: CardCycle[]
  /** カード利用と照合済みの固定費ID（実取引がカードのサイクルに入っている） */
  matchedFixedCostIds: Set<string>
  /** 口座ID → 残高の記録日 'YYYY-MM-DD' */
  balanceDateByAccount: Map<string, string>
  /**
   * 最も古い残高の記録日。引落口座が分からない支払いの基準日。
   * null（残高不明）のときはこの関数を呼ばない
   */
  oldestBalanceDate: string | null
  /**
   * 固定費カテゴリ名。含まれるカテゴリは fixedUnpaid、それ以外は scheduledUnpaid。
   * 未指定なら予定支払いはすべて fixedUnpaid に入れる（合計は変わらない）
   */
  fixedNames?: ReadonlySet<string>
}

function yen(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function day(value: string): string {
  return value.slice(0, 10)
}

export function computeObligations(input: ObligationsInput): Obligations {
  const month = input.monthEnd.slice(0, 7)
  const monthEnd = day(input.monthEnd)
  const baseDateFor = (accountId: string | null | undefined): string | null =>
    (accountId ? input.balanceDateByAccount.get(accountId) : undefined) ?? input.oldestBalanceDate

  const result: Obligations = {
    cardUnpaid: 0,
    fixedUnpaid: 0,
    scheduledUnpaid: 0,
    expectedIncome: 0,
    items: [],
  }

  // カード：支払日が基準日以降（同日を含む）。月をまたいでも含める（すでに使ったお金）
  for (const cycle of input.cardCycles) {
    const base = baseDateFor(cycle.debitAccountId)
    if (base === null) continue
    if (day(cycle.paymentDate) < base) continue // 残高に反映済み
    const amount = yen(cycle.confirmedAmount ?? cycle.amount)
    if (amount === 0) continue
    result.cardUnpaid += amount
    result.items.push({ label: `${cycle.cardName}（${cycle.paymentDate}引落）`, amount, kind: 'card' })
  }

  // 予定支払い：基準日以降（同日を含む）〜月末。入金は基準日より後〜月末
  for (const payment of input.scheduled) {
    if (!payment.is_active) continue
    if (!payment.resolvedDueDate) continue // この月は対象外（年払い・契約期間外など）
    if (payment.last_paid_month === month) continue
    const due = day(payment.resolvedDueDate)
    if (due > monthEnd) continue
    const base = baseDateFor(payment.debit_account_id)
    if (base === null) continue
    const amount = yen(payment.resolvedAmountYen)
    if (amount === 0) continue

    if (payment.type === 'income') {
      // F17：入金は支出ではない。記録日と同じ日は反映済みか分からないので足さない
      if (due <= base) continue
      result.expectedIncome += amount
      result.items.push({ label: payment.name, amount, kind: 'income' })
      continue
    }

    // カード請求はカードのサイクルで計上済み
    if (isCardBillPayment(payment)) continue
    // カード払いの固定費はカードの利用として計上される
    if (payment.payment_method === 'credit_card') continue
    if (input.matchedFixedCostIds.has(payment.id)) continue
    if (due < base) continue // 残高に反映済み

    const isFixed = input.fixedNames ? input.fixedNames.has(payment.category ?? '') : true
    if (isFixed) result.fixedUnpaid += amount
    else result.scheduledUnpaid += amount
    result.items.push({ label: payment.name, amount, kind: isFixed ? 'fixed' : 'scheduled' })
  }

  return result
}

// ---------------------------------------------------------------- 日付

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = day(dateKey).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${day(to)}T00:00:00Z`) - Date.parse(`${day(from)}T00:00:00Z`)) / 86_400_000) + 1
}

/** 90日バッファの窓 [today-89, today] と、取引の取得開始日 today-119 */
export function bufferWindow(today: string): { from: string; to: string; fetchFrom: string } {
  return {
    from: addDays(today, -(LIVING_BUFFER_WINDOW_DAYS - 1)),
    to: day(today),
    fetchFrom: addDays(today, -(CAPACITY_TRANSACTION_FETCH_DAYS - 1)),
  }
}

/**
 * 直近90日の変動生活費と、取引データがある日数。
 * 積立投資は生活費ではないので、固定費カテゴリと同じく除外する。
 */
export function summarizeBufferSpending(
  transactions: BudgetTransaction[],
  options: { today: string; fixedNames: string[]; excludeTransactionIds?: Iterable<string> }
): { variableSpend90d: number; dataCoverageDays: number } {
  const window = bufferWindow(options.today)
  const normalized = transactions.map(tx => ({ ...tx, date: day(tx.date) }))
  const investmentNames = new Set(
    normalized.map(tx => tx.category).filter(category => isInvestmentCategory(category))
  )
  const { total } = summarizeVariableSpendingInRange(normalized, {
    from: window.from,
    to: window.to,
    fixedNames: [...options.fixedNames, ...investmentNames],
    excludeTransactionIds: options.excludeTransactionIds,
  })

  const dates = normalized.map(tx => tx.date).filter(date => date <= window.to)
  const oldest = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null
  const dataCoverageDays =
    oldest === null
      ? 0
      : Math.min(daysBetweenInclusive(oldest, window.to), CAPACITY_TRANSACTION_FETCH_DAYS)

  return { variableSpend90d: total, dataCoverageDays }
}

/**
 * 投資可能額用のカードサイクル。
 *
 * buildCardCycles は「今日より前に引き落とされたサイクル」を落とすが、
 * 残高の記録日より後に引き落とされたものは残高にまだ反映されていない。
 * そこで since（最も古い記録日）から組み立て、締め前かどうか・確定額は今日を基準に付け直す。
 */
export function capacityCardCycles(
  transactions: Transaction[],
  creditCards: CreditCardSetting[],
  options: { today: string; since: string; confirmedStatements: Map<string, number> }
): CardCycle[] {
  const today = day(options.today)
  const since = day(options.since) < today ? day(options.since) : today
  return buildCardCycles(transactions, creditCards, parseISO(since), options.confirmedStatements).map(cycle => {
    const open = today <= cycle.periodEnd
    return {
      ...cycle,
      open,
      confirmedAmount: open
        ? null
        : options.confirmedStatements.get(`${cycle.cardId}|${cycle.paymentDate}`) ?? null,
    }
  })
}
