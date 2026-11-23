// lib/services/monthly-cash-chart.ts
//
// 「支払い予定」タブの月別見通しグラフのデータ（UpcomingPayments.tsx から切り出した純関数）。
// 開始残高が不明（null）なら作らない。0円から始めた棒を描くと、
// 残高未登録が「現預貯金0円」に見えてしまう（不明を0円にしない）。
import { endOfMonth, format, isWithinInterval, parseISO } from 'date-fns'
import type { DailyBalance } from '@/types/cashflow'

export type MonthlyCashChartRow = {
  month: string
  totalAssets: number
  cash: number
  expense: number
}

export function monthlyCashChartData(input: {
  months: Date[]
  projectedDays: DailyBalance[]
  startingBalance: number | null
  investmentValue: number
}): MonthlyCashChartRow[] {
  const startingBalance = input.startingBalance
  if (startingBalance === null) return []
  return input.months.map(monthStart => {
    const monthEnd = endOfMonth(monthStart)
    const days = input.projectedDays.filter(day =>
      isWithinInterval(parseISO(day.date), { start: monthStart, end: monthEnd })
    )
    const endingCash = days.length > 0 ? days[days.length - 1].balance : startingBalance
    const expense = days.reduce(
      (sum, day) =>
        sum +
        day.payments
          .filter(payment => payment.type !== 'income')
          .reduce((daySum, payment) => daySum + payment.amount, 0),
      0
    )
    return {
      month: format(monthStart, 'M月'),
      totalAssets: Math.max(Math.round(endingCash + input.investmentValue), 0),
      cash: Math.max(Math.round(endingCash), 0),
      expense,
    }
  })
}
