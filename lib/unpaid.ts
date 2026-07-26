// lib/unpaid.ts
import type { ScheduledPayment } from '@/types/cashflow'
import { resolveDueDate } from '@/lib/services/fixed-costs'

function currentYearMonth(today = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 有効な固定費のうち、「今月の支払日を過ぎている」かつ
 * 「今月分がまだ支払い済みにされていない(last_paid_monthが今月ではない)」ものを返す。
 *
 * 支払日は lib/services/fixed-costs.ts の resolveDueDate で解決する。営業日補正で
 * 26日(土) → 28日(月) にずれた固定費を、26日時点で未納と誤判定しないため。
 *
 * 注意: 複数ヶ月分をまとめて未納として積み上げる仕組みではなく、
 * 直近1ヶ月分の未納だけを検出するシンプルな実装。
 */
export function getUnpaidScheduledPayments(
  payments: ScheduledPayment[],
  today = new Date()
): ScheduledPayment[] {
  const thisMonth = currentYearMonth(today)
  const todayKey = toDateKey(today)

  return payments.filter(p => {
    if (!p.is_active) return false
    if (p.last_paid_month === thisMonth) return false

    const dueDate = resolveDueDate(p, thisMonth)
    // 今月は請求が発生しない(契約期間外・年払いの対象外月)なら未納ではない
    if (!dueDate) return false
    return dueDate < todayKey
  })
}
