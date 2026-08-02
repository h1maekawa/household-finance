// lib/cashflow.ts
import type { ScheduledPayment, DailyBalance, CreditCardSetting } from '@/types/cashflow'
import type { Transaction } from '@/types/transaction'
import { format, addDays, addMonths, getDaysInMonth, isAfter, isBefore, parseISO } from 'date-fns'
// CardPlan は型なので `type` を付ける。付けないと node --test の型ストリップが
// 実行時の named import を残してしまい、モジュール解決に失敗する。
import {
  CARD_PAYMENT_RULES,
  calcPaymentDate,
  isRakutenMarketTx,
  type CardPlan,
} from './card-payment-rules'
import { nextBusinessDay } from './holiday-jp'
import {
  resolveAmountYen,
  resolveDueDate,
  resolveMonthlyDebits,
  type FxRates,
} from './services/fixed-costs'

type CashflowOptions = {
  monthlyIncome?: number
  incomeDay?: number
  /** 外貨建て固定費の円換算に使うレート表。未指定なら円建てとして扱う */
  fxRates?: FxRates
  /** 予測の起点。既定は実行時の「今日」。テストから固定できるようにしている */
  today?: Date
  /** カード払いの固定費を、カードの支払日・引落口座へ付け替えるために使う */
  creditCards?: CreditCardSetting[]
}

function clampDay(year: number, monthIndex: number, day: number) {
  const daysInMonth = getDaysInMonth(new Date(year, monthIndex, 1))
  return Math.min(Math.max(day, 1), daysInMonth)
}

function dateForDay(year: number, monthIndex: number, day: number) {
  return new Date(year, monthIndex, clampDay(year, monthIndex, day))
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[（）()]/g, '')
}

function cardMatchesTransaction(tx: Transaction, normalizedCardName: string) {
  const paymentMethod = normalizeName(tx.payment_method ?? '')
  const cardIssuer = normalizeName(tx.card_issuer ?? '')
  return (
    paymentMethod === normalizedCardName ||
    cardIssuer === normalizedCardName ||
    (cardIssuer.length > 0 && normalizedCardName.includes(cardIssuer)) ||
    (cardIssuer.length > 0 && cardIssuer.includes(normalizedCardName))
  )
}

/**
 * 「クレジットカードで払った支出」に見えるか。
 * card_issuer が空でも payment_method が汎用の「クレジットカード」なら該当する。
 */
function looksLikeCardUsage(tx: Transaction) {
  if (tx.kind === 'income') return false
  if (tx.card_issuer) return true
  const method = normalizeName(tx.payment_method ?? '')
  return method.includes('クレジット') || method.includes('card') || method.includes('カード')
}

export type UnassignedCardUsage = {
  /** どのカード設定にも紐づかなかったカード利用の合計額 */
  total: number
  count: number
  /** 'YYYY-MM' → 合計額。どの月の請求がズレるかを画面で示すために使う */
  byMonth: Record<string, number>
}

/**
 * カード払いに見えるのに、登録済みのどのカードにも一致しない取引を集計する。
 *
 * これらは buildGeneratedCreditPayments のどのグループにも入らないため、
 * 放っておくと請求見込みから黙って消える(実データで16,162円が消えていた)。
 * 消えたことを数字で見せて、card_issuer の修正へ誘導するのがこの関数の役目。
 */
export function findUnassignedCardUsage(
  transactions: Transaction[],
  creditCards: CreditCardSetting[]
): UnassignedCardUsage {
  const normalizedNames = creditCards.map(card => normalizeName(card.name))
  const byMonth: Record<string, number> = {}
  let total = 0
  let count = 0

  for (const tx of transactions) {
    if (!looksLikeCardUsage(tx)) continue
    if (normalizedNames.some(name => cardMatchesTransaction(tx, name))) continue
    const month = tx.date.slice(0, 7)
    byMonth[month] = (byMonth[month] ?? 0) + tx.amount
    total += tx.amount
    count += 1
  }

  return { total, count, byMonth }
}

function numberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getCardClosingDate(paymentDate: Date, closingDay: number, monthOffset: number) {
  const closingMonth = addMonths(paymentDate, -monthOffset)
  return dateForDay(closingMonth.getFullYear(), closingMonth.getMonth(), closingDay)
}

function isWithinBillingPeriod(date: Date, start: Date, end: Date) {
  return (isAfter(date, start) || format(date, 'yyyy-MM-dd') === format(start, 'yyyy-MM-dd')) &&
    (isBefore(date, end) || format(date, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd'))
}

export function getCashflowFetchStart() {
  return format(addMonths(new Date(), -3), 'yyyy-MM-dd')
}

export function getCashflowFetchEnd(days: number = 45) {
  return format(addDays(new Date(), days), 'yyyy-MM-dd')
}

function getBillingPeriod(usedAt: Date, plan: CardPlan, memo?: string | null): { start: Date; end: Date } {
  const effectivePlan: CardPlan =
    plan === 'rakuten_standard' && isRakutenMarketTx(memo)
      ? 'rakuten_market'
      : plan

  const rule = CARD_PAYMENT_RULES[effectivePlan]
  const year = usedAt.getFullYear()
  const month = usedAt.getMonth()

  if (rule.closingDay === 'end_of_month') {
    const start = new Date(year, month, 1)
    const end = new Date(year, month + 1, 0)
    return { start, end }
  } else {
    const closingDay = rule.closingDay as number
    if (usedAt.getDate() <= closingDay) {
      const end = new Date(year, month, closingDay)
      const prevMonth = addMonths(new Date(year, month, 1), -1)
      const start = addDays(new Date(prevMonth.getFullYear(), prevMonth.getMonth(), closingDay), 1)
      return { start, end }
    } else {
      const start = addDays(new Date(year, month, closingDay), 1)
      const nextMonth = addMonths(new Date(year, month, 1), 1)
      const end = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), closingDay)
      return { start, end }
    }
  }
}

/** カード1サイクル分の締め期間と引き落とし日 */
export type CardCycleWindow = {
  /** 締め期間の開始日 'YYYY-MM-DD' */
  periodStart: string
  /** 締め日 'YYYY-MM-DD' */
  periodEnd: string
  /** 引き落とし日(土日祝シフト済み) 'YYYY-MM-DD' */
  paymentDate: string
}

function toKey(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

/**
 * プラン未設定・未対応カード向けに、利用日から締め期間と引き落とし日を求める。
 *
 * buildGeneratedCreditPayments の generic 分岐が「引き落とし日 → 締め期間」と
 * 逆算していたのと同じ規則を、「利用日 → サイクル」の向きで表したもの。
 * 前サイクルの締め日も独立に月末クランプする点まで揃えている
 * (addMonths(closing, -1) だと 2/28 → 1/28 となり 1/29〜1/31 が二重集計される)。
 */
function resolveGenericCycle(usedAt: Date, card: CreditCardSetting): CardCycleWindow | null {
  const closingDay = numberOrDefault(card.closing_day_int ?? parseInt(card.closing_day, 10), 31)
  const paymentDay = numberOrDefault(card.payment_day_int ?? parseInt(card.payment_day, 10), 27)
  const offset = numberOrDefault(card.payment_month_offset, 1)
  if (paymentDay < 1) return null

  // 利用日が当月の締め日を過ぎていれば、翌月締めのサイクルに入る
  let closing = dateForDay(usedAt.getFullYear(), usedAt.getMonth(), closingDay)
  if (usedAt > closing) {
    const next = addMonths(closing, 1)
    closing = dateForDay(next.getFullYear(), next.getMonth(), closingDay)
  }

  const prev = addMonths(closing, -1)
  const previousClosing = dateForDay(prev.getFullYear(), prev.getMonth(), closingDay)

  const paymentMonth = addMonths(closing, offset)
  const rawPaymentDate = dateForDay(paymentMonth.getFullYear(), paymentMonth.getMonth(), paymentDay)

  return {
    periodStart: toKey(addDays(previousClosing, 1)),
    periodEnd: toKey(closing),
    paymentDate: toKey(nextBusinessDay(rawPaymentDate)),
  }
}

/**
 * 利用日 → そのカードの締め期間・引き落とし日。
 * プランが設定されていればプランのルール、無ければカード個別の締め日設定を使う。
 */
export function resolveCardCycle(
  usedAt: Date,
  card: CreditCardSetting,
  memo?: string | null
): CardCycleWindow | null {
  const plan = (card.card_plan || 'generic') as CardPlan
  const rule = CARD_PAYMENT_RULES[plan]

  if (plan !== 'generic' && rule?.supported) {
    const paymentDate = calcPaymentDate(usedAt, plan, memo)
    if (!paymentDate) return null
    const { start, end } = getBillingPeriod(usedAt, plan, memo)
    return { periodStart: toKey(start), periodEnd: toKey(end), paymentDate: toKey(paymentDate) }
  }

  return resolveGenericCycle(usedAt, card)
}

/**
 * 確定請求額を保存する scheduled_payments 行の external_id。
 *
 * カード + 引き落とし日で一意にすることで、
 *   ・同じサイクルへの二重登録を DB の unique 制約で防げる
 *   ・見込み(generated)の打ち消しを、あいまいな名前一致ではなく完全一致で判定できる
 */
export function statementExternalId(cardId: string, paymentDate: string) {
  return `card-statement-${cardId}-${paymentDate}`
}

/** 確定請求額の行を「カードID|引き落とし日 → 金額」に畳む */
export function indexConfirmedStatements(payments: ScheduledPayment[]): Map<string, number> {
  const index = new Map<string, number>()
  for (const payment of payments) {
    if (payment.source !== 'card_statement') continue
    if (!payment.credit_card_id || !payment.scheduled_date) continue
    index.set(`${payment.credit_card_id}|${payment.scheduled_date}`, payment.amount)
  }
  return index
}

/** 締め前・締め後の1サイクル分。画面に「今いくら溜まっているか」を出すために使う */
export type CardCycle = CardCycleWindow & {
  cardId: string
  cardName: string
  amount: number
  transactionCount: number
  /** 締め日が未到来 = この金額はまだ増える */
  open: boolean
  debitAccountId: string | null
  /** カード会社が確定させた請求額。締め前は常に null(カード会社側も未確定のため) */
  confirmedAmount: number | null
}

/**
 * カードごとに「これから引き落とされるサイクル」を組み立てる。
 *
 * buildGeneratedCreditPayments が返すのは予測に載せる支払いだけなので、
 * 締め日が未到来のサイクル(＝今まさに増えている利用分)が画面から見えない。
 * SMBC 10日払いプランだと支払日が最大2ヶ月先になり、CF画面の2ヶ月ウィンドウから
 * 外れて完全に不可視になる。ここはその「溜まっている最中の額」を明示するためにある。
 */
export function buildCardCycles(
  transactions: Transaction[],
  creditCards: CreditCardSetting[],
  today: Date = new Date(),
  /** 'カードID|引き落とし日' → 確定請求額 */
  confirmedStatements: Map<string, number> = new Map()
): CardCycle[] {
  const todayKey = format(today, 'yyyy-MM-dd')
  const cycles: CardCycle[] = []

  for (const card of creditCards) {
    const normalizedCardName = normalizeName(card.name)
    const groups = new Map<string, CardCycle>()

    for (const tx of transactions) {
      if (tx.kind === 'income') continue
      if (!cardMatchesTransaction(tx, normalizedCardName)) continue

      const window = resolveCardCycle(parseISO(tx.date), card, tx.memo)
      if (!window) continue
      // 既に引き落とし済みのサイクルは「これから出ていくお金」ではない
      if (window.paymentDate < todayKey) continue

      const existing = groups.get(window.paymentDate)
      if (existing) {
        existing.amount += tx.amount
        existing.transactionCount += 1
        continue
      }
      const open = todayKey <= window.periodEnd
      groups.set(window.paymentDate, {
        ...window,
        cardId: card.id,
        cardName: card.name,
        amount: tx.amount,
        transactionCount: 1,
        open,
        debitAccountId: card.debit_account_id ?? null,
        // 締め前はカード会社側も金額を確定させていないので、確定額は存在しえない
        confirmedAmount: open
          ? null
          : confirmedStatements.get(`${card.id}|${window.paymentDate}`) ?? null,
      })
    }

    cycles.push(...groups.values())
  }

  return cycles.sort((a, b) =>
    a.paymentDate === b.paymentDate ? a.cardName.localeCompare(b.cardName) : a.paymentDate < b.paymentDate ? -1 : 1
  )
}

export function buildGeneratedCreditPayments(
  transactions: Transaction[],
  creditCards: CreditCardSetting[],
  days: number = 45
): ScheduledPayment[] {
  const result: ScheduledPayment[] = []
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const windowEnd = addDays(todayStart, days - 1)

  for (const card of creditCards) {
    const cardPlan = (card.card_plan || 'generic') as CardPlan
    const rule = CARD_PAYMENT_RULES[cardPlan]
    const normalizedCardName = normalizeName(card.name)
    // カードプランが設定されていれば、closing_day_int / payment_day_int が入っていても
    // プランのルール（締め日・支払日）を優先する。
    // ※ 以前は legacy カラムが入っているとプランが無視され、
    //    SMBC 10日プラン等の締め日が正しく計算されなかった。
    const usePlanRule = cardPlan !== 'generic' && Boolean(rule?.supported)

    if (usePlanRule) {
      // 1. Filter transactions matching the card
      const cardTx = transactions.filter(tx => {
        if (tx.kind === 'income') return false
        return cardMatchesTransaction(tx, normalizedCardName)
      })

      // 2. Group transactions by their computed payment date
      const groups = new Map<string, { txs: Transaction[]; paymentDate: Date }>()

      for (const tx of cardTx) {
        const txDate = parseISO(tx.date)
        const paymentDate = calcPaymentDate(txDate, cardPlan, tx.memo)
        if (!paymentDate) continue

        // Check if the payment date is within the projection window
        if (paymentDate >= todayStart && paymentDate <= windowEnd) {
          const key = format(paymentDate, 'yyyy-MM-dd')
          if (!groups.has(key)) {
            groups.set(key, { txs: [], paymentDate })
          }
          groups.get(key)!.txs.push(tx)
        }
      }

      // 3. Generate ScheduledPayment objects for each group
      const sortedKeys = Array.from(groups.keys()).sort()
      for (const key of sortedKeys) {
        const { txs, paymentDate } = groups.get(key)!
        const amount = txs.reduce((sum, tx) => sum + tx.amount, 0)
        if (amount <= 0) continue

        // Calculate the combined billing period
        let minStart: Date | null = null
        let maxEnd: Date | null = null

        for (const tx of txs) {
          const { start, end } = getBillingPeriod(parseISO(tx.date), cardPlan, tx.memo)
          if (!minStart || start < minStart) minStart = start
          if (!maxEnd || end > maxEnd) maxEnd = end
        }

        const memoStr = minStart && maxEnd
          ? `${format(minStart, 'M/d')}〜${format(maxEnd, 'M/d')} 利用分`
          : 'カード利用分'

        result.push({
          id: `generated-credit-${card.id}-${key}`,
          name: `${card.name} 請求見込み`,
          amount,
          due_day: paymentDate.getDate(),
          category: 'クレカ請求',
          type: 'credit',
          is_active: true,
          memo: memoStr,
          bank_account: card.bank_account ?? null,
          // 確定請求額(source: 'card_statement')との突合を、名前の部分一致ではなく
          // カードID + 引き落とし日の完全一致でやるために持たせる。
          // payment_method は付けないので resolveMonthlyDebits の付け替え対象にはならない。
          credit_card_id: card.id,
          scheduled_date: key,
          generated: true,
          source: 'credit_card',
          created_at: new Date().toISOString(),
        })
      }
    } else {
      // Fallback: Generic / Unsupported plan
      for (let i = -7; i < days + 7; i++) {
        const rawPaymentDate = addDays(todayStart, i)
        const paymentDay = numberOrDefault(card.payment_day_int ?? parseInt(card.payment_day, 10), 27)
        const effectivePaymentDay = clampDay(rawPaymentDate.getFullYear(), rawPaymentDate.getMonth(), paymentDay)
        if (rawPaymentDate.getDate() !== effectivePaymentDay) continue

        const shiftedPaymentDate = nextBusinessDay(rawPaymentDate)
        if (shiftedPaymentDate < todayStart || shiftedPaymentDate > windowEnd) continue

        const closingDay = numberOrDefault(card.closing_day_int ?? parseInt(card.closing_day, 10), 31)
        const monthOffset = numberOrDefault(card.payment_month_offset, 1)

        const closingDate = getCardClosingDate(rawPaymentDate, closingDay, monthOffset)
        // 前サイクルの締め日も同じクランプ規則で算出する。
        // ※ addMonths(closingDate, -1) だと 2/28 → 1/28 となり、1/29〜1/31 が二重集計されていた。
        const previousClosingDate = getCardClosingDate(rawPaymentDate, closingDay, monthOffset + 1)
        const periodStart = addDays(previousClosingDate, 1)
        const periodEnd = closingDate

        const amount = transactions
          .filter(tx => {
            if (tx.kind === 'income') return false
            if (!cardMatchesTransaction(tx, normalizedCardName)) return false
            const txDate = parseISO(tx.date)
            return isWithinBillingPeriod(txDate, periodStart, periodEnd)
          })
          .reduce((sum, tx) => sum + tx.amount, 0)

        if (amount <= 0) continue

        const scheduledDate = format(shiftedPaymentDate, 'yyyy-MM-dd')
        result.push({
          id: `generated-credit-${card.id}-${scheduledDate}`,
          name: `${card.name} 請求見込み`,
          amount,
          due_day: shiftedPaymentDate.getDate(),
          category: 'クレカ請求',
          type: 'credit',
          is_active: true,
          memo: `${format(periodStart, 'M/d')}〜${format(periodEnd, 'M/d')} 利用分`,
          bank_account: card.bank_account ?? null,
          // 確定請求額(source: 'card_statement')との突合を、名前の部分一致ではなく
          // カードID + 引き落とし日の完全一致でやるために持たせる。
          // payment_method は付けないので resolveMonthlyDebits の付け替え対象にはならない。
          credit_card_id: card.id,
          scheduled_date: scheduledDate,
          generated: true,
          source: 'credit_card',
          created_at: new Date().toISOString(),
        })
      }
    }
  }

  return result
}

/**
 * 予測期間にかかる各月について固定費を解決し、日付 → 支払い のインデックスを作る。
 *
 * ここで lib/services/fixed-costs.ts を通すことで、予測に
 * 営業日補正・契約期間・外貨換算・カード払いの付け替えが一度に効く。
 * 前月ぶんも解決するのは、前月に利用したカード払いの固定費が
 * 当月に引き落とされるため。
 */
function buildPaymentIndex(
  payments: ScheduledPayment[],
  cards: CreditCardSetting[],
  today: Date,
  days: number,
  fx: FxRates
): Map<string, { payment: ScheduledPayment; amount: number }[]> {
  const index = new Map<string, { payment: ScheduledPayment; amount: number }[]>()
  const push = (date: string, entry: { payment: ScheduledPayment; amount: number }) => {
    const list = index.get(date) ?? []
    list.push(entry)
    index.set(date, list)
  }

  const byId = new Map(payments.map(p => [p.id, p]))
  const months = new Set<string>()
  for (let i = -1; i <= Math.ceil(days / 28) + 1; i++) {
    months.add(format(addMonths(today, i), 'yyyy-MM'))
  }

  for (const month of months) {
    // 支出: カード払いの付け替えを含めて解決する
    for (const debit of resolveMonthlyDebits(payments, cards, month, fx)) {
      const payment = byId.get(debit.id)
      if (payment) push(debit.date, { payment, amount: debit.amount })
    }

    // 収入: resolveMonthlyDebits の対象外なので個別に解決する
    for (const payment of payments) {
      if (payment.type !== 'income' || !payment.is_active) continue
      const date = resolveDueDate(payment, month)
      if (date) push(date, { payment, amount: resolveAmountYen(payment, fx) })
    }
  }

  return index
}

export function projectCashflow(
  currentBalance: number,
  scheduledPayments: ScheduledPayment[],
  days: number = 30,
  options: CashflowOptions = {}
): DailyBalance[] {
  const result: DailyBalance[] = []
  const today = options.today ?? new Date()
  let balance = currentBalance

  const activePayments = scheduledPayments.filter((p) => p.is_active)
  const incomeDay = Math.min(Math.max(Number(options.incomeDay ?? 25), 1), 31)
  const monthlyIncome = Math.max(Math.round(Number(options.monthlyIncome ?? 0)), 0)
  const fx = options.fxRates ?? {}

  const paymentIndex = buildPaymentIndex(
    activePayments,
    options.creditCards ?? [],
    today,
    days,
    fx
  )

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i)
    const dateStr = format(date, 'yyyy-MM-dd')
    const dayOfMonth = date.getDate()
    const daysInMonth = getDaysInMonth(date)

    const resolvedForDay = paymentIndex.get(dateStr) ?? []
    // 円換算後の金額を反映した支払いを表示する(外貨建て固定費は原資産額ではなく円で見せる)
    const paymentsForDay: ScheduledPayment[] = resolvedForDay.map(
      ({ payment, amount }) => (amount === payment.amount ? payment : { ...payment, amount })
    )

    const effectiveIncomeDay = Math.min(incomeDay, daysInMonth)
    if (monthlyIncome > 0 && dayOfMonth === effectiveIncomeDay) {
      paymentsForDay.push({
        id: `generated-income-${dateStr}`,
        name: '毎月の固定収入',
        amount: monthlyIncome,
        due_day: effectiveIncomeDay,
        category: '給与',
        type: 'income',
        is_active: true,
        scheduled_date: dateStr,
        generated: true,
        source: 'monthly_income',
        created_at: new Date().toISOString(),
      })
    }

    const dailyChange = paymentsForDay.reduce((sum, p) => {
      return p.type === 'income' ? sum + p.amount : sum - p.amount
    }, 0)
    balance += dailyChange

    result.push({
      date: dateStr,
      balance,
      payments: paymentsForDay,
      isNegative: balance < 0,
    })
  }

  return result
}
