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
//   ただし入金で口座が分からないもの（給与など）は最も新しい記録日で判定する（入金の安全側）。
import { parseISO } from 'date-fns'
import { buildCardCycles, type CardCycle } from '@/lib/cashflow'
import { toJstDateKey } from '@/lib/jst'
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
  /** 口座引落の積立（投資カテゴリ）。ここでは差し引かず computeInvestmentOutflows へ渡す */
  investmentPayments: InvestmentPaymentInput[]
}

export type InvestmentPaymentInput = {
  id: string
  due: string
  amount: number
  debitAccountId: string | null
  /** 'card'：カード払い。カードのサイクル／請求で差し引くので、ここでは予定額を差し引かない */
  funding?: 'account' | 'card'
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
  /**
   * 毎月の固定収入（users_profile.monthly_income / 予算の income_planned）。
   * scheduled_payments には入っていないので別に渡す（salaryIncome で作る）。
   * 給与の入金口座は分からないので、最も新しい記録日で判定する（入金の安全側）
   */
  salary?: { amount: number; date: string } | null
  /** カードID → 引落口座ID。確定請求の基準日に使う */
  cardDebitAccountById?: Map<string, string | null>
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
  // 入金で口座が分からないものは、最も新しい記録日で判定する。どの口座に入ったか
  // 分からない入金は、いちばん新しい残高にすでに入っているかもしれない（足さない側）
  const recordedDates = [...input.balanceDateByAccount.values()]
  const newestBalanceDate =
    recordedDates.length > 0 ? recordedDates.reduce((a, b) => (a > b ? a : b)) : input.oldestBalanceDate
  const incomeBaseDateFor = (accountId: string | null | undefined): string | null =>
    (accountId ? input.balanceDateByAccount.get(accountId) : undefined) ?? newestBalanceDate

  const result: Obligations = {
    cardUnpaid: 0,
    fixedUnpaid: 0,
    scheduledUnpaid: 0,
    expectedIncome: 0,
    items: [],
    investmentPayments: [],
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

  // 確定請求（カード請求の行）。カード利用が取り込まれていないと上のサイクルが
  // 作られないので、同じ「カードID|支払日」のサイクルが無いものだけをここで数える
  const coveredCycleKeys = new Set(input.cardCycles.map(c => `${c.cardId}|${day(c.paymentDate)}`))
  for (const payment of input.scheduled) {
    if (!payment.is_active) continue
    if (!isCardBillPayment(payment)) continue
    if (payment.last_paid_month === month) continue
    const dueRaw = payment.resolvedDueDate ?? payment.scheduled_date
    if (!dueRaw) continue
    const due = day(dueRaw)
    const key = payment.credit_card_id ? `${payment.credit_card_id}|${due}` : null
    if (key && coveredCycleKeys.has(key)) continue
    const cardDebit = payment.credit_card_id
      ? input.cardDebitAccountById?.get(payment.credit_card_id)
      : undefined
    const base = baseDateFor(cardDebit ?? payment.debit_account_id)
    if (base === null || due < base) continue // 残高に反映済み
    const amount = yen(payment.resolvedAmountYen)
    if (amount === 0) continue
    // 同じカード・同じ支払日の確定請求が複数あっても1回だけ数える
    if (key) coveredCycleKeys.add(key)
    result.cardUnpaid += amount
    result.items.push({ label: `${payment.name}（${due}引落）`, amount, kind: 'card' })
  }

  // 給与：基準日より後（同日を含まない）〜月末。入金口座が分からないので最も新しい記録日
  const salaryBase = incomeBaseDateFor(null)
  if (input.salary && input.salary.amount > 0 && salaryBase !== null) {
    const date = day(input.salary.date)
    if (date > salaryBase && date <= monthEnd) {
      const amount = yen(input.salary.amount)
      result.expectedIncome += amount
      result.items.push({ label: '毎月の固定収入', amount, kind: 'income' })
    }
  }

  // 予定支払い：基準日以降（同日を含む）〜月末。入金は基準日より後〜月末
  for (const payment of input.scheduled) {
    if (!payment.is_active) continue
    if (!payment.resolvedDueDate) continue // この月は対象外（年払い・契約期間外など）
    const due = day(payment.resolvedDueDate)
    if (due > monthEnd) continue

    // 投資カテゴリの積立は、買付との対応づけ（computeInvestmentOutflows）に全件渡す。
    // 記録日より前・今月支払い済みでも、買付が単独で数えられないよう対応づけには必要。
    // 記録日との比較は computeInvestmentOutflows が行う
    if (payment.type !== 'income' && !isCardBillPayment(payment) && isInvestmentCategory(payment.category)) {
      const investmentAmount = yen(payment.resolvedAmountYen)
      if (investmentAmount !== 0) {
        result.investmentPayments.push({
          id: payment.id,
          due,
          amount: investmentAmount,
          debitAccountId: payment.debit_account_id ?? null,
          funding:
            payment.payment_method === 'credit_card' || input.matchedFixedCostIds.has(payment.id)
              ? 'card'
              : 'account',
        })
      }
      continue
    }

    if (payment.last_paid_month === month) continue
    const base = baseDateFor(payment.debit_account_id)
    if (base === null) continue
    const amount = yen(payment.resolvedAmountYen)
    if (amount === 0) continue

    if (payment.type === 'income') {
      // F17：入金は支出ではない。記録日と同じ日は反映済みか分からないので足さない。
      // 入金口座が分からないものは最も新しい記録日で判定する
      const incomeBase = incomeBaseDateFor(payment.debit_account_id)
      if (incomeBase === null || due <= incomeBase) continue
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

// ---------------------------------------------------------------- 投資済み額

/** 買付の判定（売却・分配金は除く）。alreadyInvested と投資の二重計上判定で同じ定義を使う */
const BUY_TRADE_TYPE = /買|buy|購入|積立|再投資/

export function isBuyTradeType(tradeType: unknown): boolean {
  return BUY_TRADE_TYPE.test(String(tradeType ?? '').toLowerCase())
}

/** 残高の記録時刻 → 日本時間の記録日 'YYYY-MM-DD' */
export function balanceDateKey(recordedAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(recordedAt)) return recordedAt
  const time = Date.parse(recordedAt)
  return Number.isFinite(time) ? toJstDateKey(new Date(time)) : recordedAt.slice(0, 10)
}

/**
 * 今月すでに投資した額のうち、残高にまだ反映されていないもの。
 * 記録日より前の買付は残高から引かれ済みなので数えない。記録日と同じ日は
 * 反映済みか分からないので数える（安全側）。
 * 記録日時が不明なら null（0円で埋めない）。
 *
 * 呼び出し側は今日より後の買付を渡さないこと。数えた買付は必ず
 * 積立の二重計上判定の窓 [記録日, 今日] に入る。
 */
export function sumInvestedAfterBalance(
  trades: { trade_date: string; trade_type: string; amount: number }[],
  input: { month: string; balanceOldestRecordedAt: string | null }
): number | null {
  if (input.balanceOldestRecordedAt === null) return null
  const balanceDate = balanceDateKey(input.balanceOldestRecordedAt)
  return trades
    .filter(trade => {
      if (!isBuyTradeType(trade.trade_type)) return false
      const date = day(String(trade.trade_date))
      return date >= balanceDate && date.slice(0, 7) === input.month
    })
    .reduce((sum, trade) => sum + Math.abs(Number(trade.amount) || 0), 0)
}

/**
 * 積立の予定支払いと買付を1対1で対応づけ、投資に関する控除を決める。
 * investment_transactions には引落口座が無いので、日付の近さで対応づける。
 *
 *   ・対応した予定＋買付は「その口座からの1回の出金」。予定額を、引落日が
 *     その口座の記録日以降のときだけ1回差し引く（買付は数えない）
 *   ・対応のない予定：その口座の記録日以降なら差し引く（実行前でも現金は出ていく）
 *   ・カード払いの積立：対応した買付も予定額も差し引かない（カード請求で差し引く）
 *   ・対応のない買付：最も古い記録日以降の当月分なら差し引く（口座不明なので安全側）
 * 記録日が不明なら null。
 */
export function computeInvestmentOutflows(input: {
  today: string
  month: string
  payments: InvestmentPaymentInput[]
  buys: { trade_date: string; amount: number }[]
  balanceDateByAccount: Map<string, string>
  oldestBalanceDate: string | null
}): {
  scheduledDeduction: number
  buyDeduction: number
  pairs: { paymentId: string; buyDate: string | null }[]
} | null {
  const oldest = input.oldestBalanceDate
  if (oldest === null) return null
  const today = day(input.today)
  const dayNumber = (date: string) => Date.parse(`${day(date)}T00:00:00Z`) / 86_400_000

  const buys = input.buys
    .map(buy => ({ date: day(String(buy.trade_date)), amount: Math.abs(yen(buy.amount)), used: false }))
    .filter(buy => buy.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const payments = input.payments
    .filter(payment => day(payment.due).slice(0, 7) === input.month)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id < b.id ? -1 : 1))

  let scheduledDeduction = 0
  let buyDeduction = 0
  const pairs: { paymentId: string; buyDate: string | null }[] = []

  for (const payment of payments) {
    const due = day(payment.due)
    let best: (typeof buys)[number] | null = null
    let bestGap = Infinity
    for (const buy of buys) {
      if (buy.used) continue
      const gap = Math.abs(dayNumber(buy.date) - dayNumber(due))
      // buys は日付の昇順。同じ距離なら先に見つけた（早い）買付を残す
      if (gap <= 3 && gap < bestGap) {
        best = buy
        bestGap = gap
      }
    }
    if (best) best.used = true
    pairs.push({ paymentId: payment.id, buyDate: best ? best.date : null })
    // カード払いは、対応した買付も予定額も差し引かない（カード側で差し引く）
    if (payment.funding === 'card') continue
    const base =
      (payment.debitAccountId ? input.balanceDateByAccount.get(payment.debitAccountId) : undefined) ?? oldest
    if (due >= base) scheduledDeduction += yen(payment.amount)
  }

  for (const buy of buys) {
    if (buy.used) continue
    if (buy.date >= oldest && buy.date.slice(0, 7) === input.month) buyDeduction += buy.amount
  }
  return { scheduledDeduction, buyDeduction, pairs }
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


/**
 * 毎月の固定収入を、対象月の入金予定1件として作る。
 *
 *   金額 = max(0, 予定 − 今月の実績)（予算の income.planned / income.actual と同じ値）
 *   日付 = income_day（既定25日）。月末を超える日は月末に丸める（projectCashflow と同じ）
 *
 * 予定が0（未設定）なら作らない。呼び出し側は「月収の設定がありません」を残す。
 */
export function salaryIncome(input: {
  month: string
  planned: number
  actual: number
  incomeDay: number | null | undefined
}): { amount: number; date: string } | null {
  const planned = yen(input.planned)
  if (planned <= 0) return null
  const [year, monthNumber] = input.month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const rawDay = Number(input.incomeDay ?? 25)
  const incomeDay = Math.min(Math.max(Number.isFinite(rawDay) ? rawDay : 25, 1), 31)
  const date = `${input.month}-${String(Math.min(incomeDay, lastDay)).padStart(2, '0')}`
  return { amount: Math.max(0, planned - yen(input.actual)), date }
}
