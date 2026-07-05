// lib/unpaid.ts
import { ScheduledPayment } from '@/types/cashflow'

function currentYearMonth(today = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

// その月の実際の最終日を超えるdue_day(31日など)は月末に丸める
function dueDateThisMonth(dueDay: number, today = new Date()): Date {
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  return new Date(today.getFullYear(), today.getMonth(), Math.min(dueDay, lastDayOfMonth))
}

/**
 * 有効な固定費のうち、「今月の支払日を過ぎている」かつ
 * 「今月分がまだ支払い済みにされていない(last_paid_monthが今月ではない)」ものを返す。
 *
 * 注意: 複数ヶ月分をまとめて未納として積み上げる仕組みではなく、
 * 直近1ヶ月分の未納だけを検出するシンプルな実装。
 */
export function getUnpaidScheduledPayments(
  payments: ScheduledPayment[],
  today = new Date()
): ScheduledPayment[] {
  const thisMonth = currentYearMonth(today)

  return payments.filter(p => {
    if (!p.is_active) return false
    if (p.last_paid_month === thisMonth) return false
    return dueDateThisMonth(p.due_day, today) < today
  })
}
