// lib/cashflow.ts
import { ScheduledPayment, DailyBalance, CreditCardSetting } from '@/types/cashflow'
import { Transaction } from '@/types/transaction'
import { format, addDays, addMonths, getDaysInMonth, isAfter, isBefore, parseISO } from 'date-fns'
import { CardPlan, CARD_PAYMENT_RULES, calcPaymentDate, isRakutenMarketTx } from './card-payment-rules'
import { nextBusinessDay } from './holiday-jp'

type CashflowOptions = {
  monthlyIncome?: number
  incomeDay?: number
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

    if (cardPlan !== 'generic' && rule && rule.supported) {
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
        const previousClosingDate = addMonths(closingDate, -1)
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

export function projectCashflow(
  currentBalance: number,
  scheduledPayments: ScheduledPayment[],
  days: number = 30,
  options: CashflowOptions = {}
): DailyBalance[] {
  const result: DailyBalance[] = []
  const today = new Date()
  let balance = currentBalance

  const activePayments = scheduledPayments.filter((p) => p.is_active)
  const incomeDay = Math.min(Math.max(Number(options.incomeDay ?? 25), 1), 31)
  const monthlyIncome = Math.max(Math.round(Number(options.monthlyIncome ?? 0)), 0)

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i)
    const dateStr = format(date, 'yyyy-MM-dd')
    const dayOfMonth = date.getDate()
    const daysInMonth = getDaysInMonth(date)

    const paymentsForDay = activePayments.filter((payment) => {
      if (payment.scheduled_date) return payment.scheduled_date === dateStr
      const effectiveDueDay = Math.min(payment.due_day, daysInMonth)
      return effectiveDueDay === dayOfMonth
    })

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
