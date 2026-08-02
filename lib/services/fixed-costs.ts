// lib/services/fixed-costs.ts
//
// 固定費を「いつ・どの口座から・いくら」に解決する決定的エンジン(要件書 §8)。
// docs/v2-ai-coach-spec.md の原則どおり、お金の数字は全てここで計算し、LLM には計算させない。
//
// ここが解いている4つのこと:
//   1. 月末クランプ  … due_day=31 は2月には無いので月末に丸める
//   2. 営業日補正    … 家賃26日が土曜なら翌営業日へ(要件書 §8「営業日補正」)
//   3. 契約期間      … start_date / end_date の外なら請求は発生しない
//   4. 外貨連動      … ジブラルタ生命 105 USD を当日レートで円換算する
//
// さらに toDebitSources() が「カード払いの固定費は自分では銀行引落を生まず、
// カードの支払日・カードの引落口座に合流する」という付け替えを行う。これが無いと
// 楽天モバイル 3,890円 が銀行からも引かれる二重計上になる。
import type {
  BusinessDayRule,
  CreditCardSetting,
  PaymentCurrency,
  Recurrence,
  ResolvedAmount,
  ScheduledPayment,
} from '@/types/cashflow'
import { adjustBusinessDay } from '@/lib/holiday-jp'
import { CARD_PAYMENT_RULES, calcPaymentDate, type CardPlan } from '@/lib/card-payment-rules'
import type { DebitSource } from './upcoming-debits'
import { daysInMonth } from './budget-engine'
import { yen } from './money'

/** 為替レート表。pair をキーに 1外貨 = N円 を持つ */
export type FxRates = Record<string, number>

/** 円換算に失敗したときの最終フォールバック(lib/stock.ts と同じ値) */
const USD_JPY_FALLBACK = 150

/**
 * 固定費のうち、日付・金額の解決に必要な最小限のフィールド。
 * ScheduledPayment をそのまま渡せるが、テストからは部分オブジェクトで呼べる。
 */
export type FixedCostLike = {
  amount: number
  due_day: number
  scheduled_date?: string | null
  start_date?: string | null
  end_date?: string | null
  recurrence?: Recurrence | null
  business_day_rule?: BusinessDayRule | null
  currency?: PaymentCurrency | null
  foreign_amount?: number | null
}

// ---------------------------------------------------------------- 日付の解決

function toDateKey(year: number, monthIndex: number, day: number): string {
  const m = String(monthIndex + 1).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${year}-${m}-${d}`
}

/**
 * 契約期間・繰り返し規則から、その月に請求が発生するかを判定する。
 * month は 'YYYY-MM'。
 */
export function isActiveInMonth(payment: FixedCostLike, month: string): boolean {
  const monthStart = `${month}-01`
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`

  // 契約開始前 / 契約終了後は請求が無い
  if (payment.start_date && payment.start_date > monthEnd) return false
  if (payment.end_date && payment.end_date < monthStart) return false

  const recurrence = payment.recurrence ?? 'monthly'
  if (recurrence === 'monthly') return true

  // 年払い・単発は、基準日(start_date、無ければ scheduled_date)の月にだけ発生する
  const anchor = payment.start_date ?? payment.scheduled_date ?? null
  if (!anchor) return recurrence === 'yearly'

  if (recurrence === 'yearly') return anchor.slice(5, 7) === month.slice(5, 7)
  return anchor.slice(0, 7) === month // 'once'
}

/**
 * その月の実際の引き落とし日(YYYY-MM-DD)。請求が発生しない月は null。
 *
 * scheduled_date（Gmail取込などで確定済みの実日付）がある場合は、それを最優先し
 * 補正もかけない。既に確定した日付をアプリ側でずらしてはいけないため。
 */
export function resolveDueDate(payment: FixedCostLike, month: string): string | null {
  if (!isActiveInMonth(payment, month)) return null

  if (payment.scheduled_date) {
    return payment.scheduled_date.slice(0, 7) === month ? payment.scheduled_date : null
  }

  const [year, monthNumber] = month.split('-').map(Number)
  if (!year || !monthNumber) return null

  // 1. 月末クランプ
  const clampedDay = Math.min(Math.max(Number(payment.due_day) || 1, 1), daysInMonth(month))

  // 2. 営業日補正
  const rule = payment.business_day_rule ?? 'none'
  const adjusted = adjustBusinessDay(new Date(year, monthNumber - 1, clampedDay), rule)
  const resolved = toDateKey(adjusted.getFullYear(), adjusted.getMonth(), adjusted.getDate())

  // 3. 補正の結果が契約期間の外へ出た場合は請求しない
  if (payment.start_date && resolved < payment.start_date) return null
  if (payment.end_date && resolved > payment.end_date) return null

  return resolved
}

// ---------------------------------------------------------------- 金額の解決

/**
 * 実際に引き落とされる整数円。外貨建ては当日レートで換算する。
 *
 * レートが取れない場合でも 0 円にはせず定数へフォールバックする。
 * 「金額0円の固定費」はキャッシュフロー予測を実態より楽観的に見せてしまい、
 * データの正確性(要件書の最優先事項)を最も損なうため。
 */
export function resolveAmountYen(payment: FixedCostLike, fx: FxRates = {}): number {
  const currency = payment.currency ?? 'JPY'
  if (currency === 'JPY') return yen(payment.amount)

  const foreign = Number(payment.foreign_amount)
  if (!Number.isFinite(foreign) || foreign === 0) return yen(payment.amount)

  const pair = `${currency}JPY`
  const rate = Number(fx[pair])
  const effectiveRate = Number.isFinite(rate) && rate > 0
    ? rate
    : (currency === 'USD' ? USD_JPY_FALLBACK : 0)

  if (effectiveRate <= 0) return yen(payment.amount)
  return yen(foreign * effectiveRate)
}

// ---------------------------------------------------------------- 変動固定費の金額

/** 変動固定費の平均に使う過去月数 */
const AVERAGE_WINDOW_MONTHS = 3

/**
 * 変動固定費（電気代・保険など）の「その月いくらで見るか」を決める。
 *
 * 優先順位（要件 §6）:
 *   1. 今月の確定金額（カード利用メール等と照合できた実額）
 *   2. ユーザーが入力した予定金額
 *   3. 直近3ヶ月の確定実績の平均
 *   4. 決められない → basis: 'unknown' として呼び出し側が警告する
 *
 * 確定金額と予定金額は足さない。確定が入ったら予定を置き換える。
 * 履歴が1〜2ヶ月しか無ければ、その月数だけで平均する（0で薄めない）。
 * 履歴が無いときに 0円 を返さないのは、0円の固定費が予測を実態より
 * 楽観的に見せてしまうため。
 *
 * @param confirmed  その月の確定額。未確定なら undefined
 * @param history    'YYYY-MM' → 確定額。未払い・金額未登録の月は含めないこと
 */
export function resolveVariableAmount(
  payment: Pick<ScheduledPayment, 'amount' | 'amount_type'>,
  month: string,
  confirmed?: number,
  history: Map<string, number> = new Map()
): ResolvedAmount {
  if (confirmed !== undefined && confirmed > 0) {
    return { amount: yen(confirmed), basis: 'confirmed' }
  }

  // 固定額は予定額がそのまま請求額
  if ((payment.amount_type ?? 'fixed') === 'fixed') {
    const planned = yen(payment.amount)
    return planned > 0 ? { amount: planned, basis: 'planned' } : { amount: 0, basis: 'unknown' }
  }

  const planned = yen(payment.amount)
  if (planned > 0) return { amount: planned, basis: 'planned' }

  const samples: number[] = []
  for (let back = 1; back <= AVERAGE_WINDOW_MONTHS; back++) {
    const value = history.get(addMonths(month, -back))
    if (value !== undefined && value > 0) samples.push(value)
  }
  if (samples.length > 0) {
    const total = samples.reduce((sum, value) => sum + value, 0)
    return {
      amount: yen(total / samples.length),
      basis: 'average',
      sampleMonths: samples.length,
    }
  }

  return { amount: 0, basis: 'unknown' }
}

// ---------------------------------------------------------------- 口座への割当

export type ResolvedDebit = {
  id: string
  name: string
  /** 円換算済みの引き落とし額 */
  amount: number
  /** 実際に引き落とされる日(営業日補正済み) */
  date: string
  /** 引き落とし口座。null は「引落口座 未確認」 */
  accountId: string | null
  /** カード払いのためカード請求へ合流した場合、そのカード名 */
  viaCardName?: string
}

/**
 * 「その月に発生する固定費」を、日付・金額・口座に解決する。
 *
 * 注意: 返る `date` が必ずしも `month` 内とは限らない。カード払いの固定費は
 * 利用月の翌月以降に引き落とされるため。month は「発生（利用）月」であって
 * 「引き落とし月」ではない。
 *
 * payment_method === 'credit_card' の固定費は、自分の due_day では落ちない。
 * due_day を「カード利用日」とみなし、カードの締め日ルールから支払日を出して、
 * カードの引落口座から落とす。ここで付け替えないと
 * 「どの口座にいくら残すべきか」が実態とズレる。
 */
export function resolveMonthlyDebits(
  payments: ScheduledPayment[],
  cards: CreditCardSetting[],
  month: string,
  fx: FxRates = {}
): ResolvedDebit[] {
  const cardsById = new Map(cards.map(card => [card.id, card]))
  const result: ResolvedDebit[] = []

  for (const payment of payments) {
    if (!payment.is_active) continue
    if (payment.type === 'income') continue

    const amount = resolveAmountYen(payment, fx)
    if (amount <= 0) continue // 金額未登録(Apple Music 等)は予測に含めない

    const method = payment.payment_method ?? 'bank_debit'
    const card = method === 'credit_card' && payment.credit_card_id
      ? cardsById.get(payment.credit_card_id)
      : undefined

    if (method === 'credit_card' && card) {
      // カード利用日 = その月の due_day。そこからカードの締め日ルールで支払日を出す。
      const usedOn = resolveDueDate({ ...payment, business_day_rule: 'none' }, month)
      if (!usedOn) continue
      const date = resolveCardPaymentDate(card, usedOn)
      if (!date) continue
      result.push({
        id: payment.id,
        name: payment.name,
        amount,
        date,
        accountId: card.debit_account_id ?? null,
        viaCardName: card.name,
      })
      continue
    }

    // 現金払いは口座残高に影響しないので、引き落としとしては扱わない
    if (method === 'cash') continue

    const date = resolveDueDate(payment, month)
    if (!date) continue
    result.push({
      id: payment.id,
      name: payment.name,
      amount,
      date,
      accountId: payment.debit_account_id ?? null,
    })
  }

  return result.sort((a, b) => (a.date === b.date ? b.amount - a.amount : a.date < b.date ? -1 : 1))
}

/**
 * カード利用日 → 引き落とし日。締め日ルールは既存の lib/card-payment-rules.ts に委譲する。
 * プラン未設定・未対応カードは、カード自身の payment_day + 支払月オフセットで代替する。
 */
function resolveCardPaymentDate(card: CreditCardSetting, usedOn: string): string | null {
  const [usedYear, usedMonth, usedDay] = usedOn.split('-').map(Number)
  if (!usedYear || !usedMonth || !usedDay) return null
  const usedAt = new Date(usedYear, usedMonth - 1, usedDay)

  const plan = (card.card_plan ?? 'generic') as CardPlan
  if (plan !== 'generic' && CARD_PAYMENT_RULES[plan]?.supported) {
    const paid = calcPaymentDate(usedAt, plan)
    if (paid) return toDateKey(paid.getFullYear(), paid.getMonth(), paid.getDate())
  }

  // generic フォールバック: 利用月 + オフセット月の payment_day（翌営業日補正込み）
  const paymentDay = Number(card.payment_day_int ?? parseInt(card.payment_day, 10))
  if (!Number.isFinite(paymentDay) || paymentDay < 1) return null

  const offset = Number(card.payment_month_offset ?? 1) || 1
  const paymentMonth = addMonths(usedOn.slice(0, 7), offset)
  const [payYear, payMonthNumber] = paymentMonth.split('-').map(Number)
  const clamped = Math.min(paymentDay, daysInMonth(paymentMonth))

  const adjusted = adjustBusinessDay(new Date(payYear, payMonthNumber - 1, clamped), 'next')
  return toDateKey(adjusted.getFullYear(), adjusted.getMonth(), adjusted.getDate())
}

/**
 * コーチ(lib/services/upcoming-debits.ts)が食べる DebitSource 形式へ変換する。
 *
 * 前月・当月・翌月の3ヶ月ぶんを解決する。前月を含めるのは、前月に利用した
 * カード払いの固定費が当月に引き落とされるため。ここを落とすと
 * 「来週の楽天カード引き落とし」に固定費ぶんが乗らない。
 * 実際の期間フィルタは buildUpcomingDebits の horizon が行う。
 */
export function toDebitSources(
  payments: ScheduledPayment[],
  cards: CreditCardSetting[],
  today: string,
  fx: FxRates = {}
): DebitSource[] {
  const thisMonth = today.slice(0, 7)
  const months = [addMonths(thisMonth, -1), thisMonth, addMonths(thisMonth, 1)]

  return months.flatMap(month =>
    resolveMonthlyDebits(payments, cards, month, fx).map<DebitSource>(debit => ({
      id: `${debit.id}-${debit.date}`,
      name: debit.viaCardName ? `${debit.name}（${debit.viaCardName}）` : debit.name,
      amount: debit.amount,
      due_day: Number(debit.date.slice(8, 10)),
      scheduled_date: debit.date,
      is_active: true,
      type: 'fixed',
      debit_account_id: debit.accountId,
    }))
  )
}

export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const zeroBased = year * 12 + (monthNumber - 1) + delta
  return `${Math.floor(zeroBased / 12)}-${String((zeroBased % 12) + 1).padStart(2, '0')}`
}
