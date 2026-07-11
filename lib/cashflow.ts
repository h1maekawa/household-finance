// lib/cashflow.ts
import { ScheduledPayment, DailyBalance, CreditCardSetting } from '@/types/cashflow'
import { Transaction } from '@/types/transaction'
import { format, addDays, addMonths, getDaysInMonth, isAfter, isBefore, parseISO } from 'date-fns'

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

export function buildGeneratedCreditPayments(
  transactions: Transaction[],
  creditCards: CreditCardSetting[],
  days: number = 45
): ScheduledPayment[] {
  const result: ScheduledPayment[] = []
  const today = new Date()

  for (let i = 0; i < days; i++) {
    const paymentDate = addDays(today, i)

    for (const card of creditCards) {
      const paymentDay = numberOrDefault(card.payment_day_int ?? parseInt(card.payment_day, 10), 27)
      const closingDay = numberOrDefault(card.closing_day_int ?? parseInt(card.closing_day, 10), 31)
      const monthOffset = numberOrDefault(card.payment_month_offset, 1)
      const effectivePaymentDay = clampDay(paymentDate.getFullYear(), paymentDate.getMonth(), paymentDay)
      if (paymentDate.getDate() !== effectivePaymentDay) continue

      const closingDate = getCardClosingDate(paymentDate, closingDay, monthOffset)
      const previousClosingDate = addMonths(closingDate, -1)
      const periodStart = addDays(previousClosingDate, 1)
      const periodEnd = closingDate
      const normalizedCardName = normalizeName(card.name)

      const amount = transactions
        .filter(tx => {
          if (tx.kind === 'income') return false
          if (normalizeName(tx.payment_method) !== normalizedCardName) return false
          const txDate = parseISO(tx.date)
          return isWithinBillingPeriod(txDate, periodStart, periodEnd)
        })
        .reduce((sum, tx) => sum + tx.amount, 0)

      if (amount <= 0) continue

      const scheduledDate = format(paymentDate, 'yyyy-MM-dd')
      result.push({
        id: `generated-credit-${card.id}-${scheduledDate}`,
        name: `${card.name} 請求見込み`,
        amount,
        due_day: effectivePaymentDay,
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

  return result
}

/**
 * 今後N日間の日別残高予測を計算する
 */
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

    // 月末日の補正: due_day > 月の日数の場合は月末として扱う
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
