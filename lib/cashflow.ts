// lib/cashflow.ts
import { ScheduledPayment, DailyBalance } from '@/types/cashflow'
import { format, addDays, getDaysInMonth } from 'date-fns'

/**
 * 今後N日間の日別残高予測を計算する
 */
export function projectCashflow(
  currentBalance: number,
  scheduledPayments: ScheduledPayment[],
  days: number = 30
): DailyBalance[] {
  const result: DailyBalance[] = []
  const today = new Date()
  let balance = currentBalance

  const activePayments = scheduledPayments.filter((p) => p.is_active)

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i)
    const dateStr = format(date, 'yyyy-MM-dd')
    const dayOfMonth = date.getDate()
    const daysInMonth = getDaysInMonth(date)

    // 月末日の補正: due_day > 月の日数の場合は月末として扱う
    const paymentsForDay = activePayments.filter((payment) => {
      const effectiveDueDay = Math.min(payment.due_day, daysInMonth)
      return effectiveDueDay === dayOfMonth
    })

    // 残高から引き落とし
    const totalPayment = paymentsForDay.reduce((sum, p) => sum + p.amount, 0)
    balance -= totalPayment

    result.push({
      date: dateStr,
      balance,
      payments: paymentsForDay,
      isNegative: balance < 0,
    })
  }

  return result
}
