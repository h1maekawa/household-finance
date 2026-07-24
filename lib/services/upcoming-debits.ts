// lib/services/upcoming-debits.ts
//
// 「次にいつ・いくら・どの口座から引き落とされるか」を決定的に組み立てる純関数。
// コーチの花形コメント(upcoming_debit / transfer_suggestion)の入力になる。
import type { UpcomingDebit } from '@/types/coach'
import { daysInMonth } from './budget-engine'
import { yen } from './money'

export type DebitSource = {
  id: string
  name: string
  amount: number
  /** 毎月の支払日(1〜31)。scheduled_date がある場合はそちらを優先 */
  due_day: number
  scheduled_date?: string | null
  is_active: boolean
  type: 'fixed' | 'credit' | 'income'
  debit_account_id?: string | null
}

function addMonthToMonthString(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const zeroBased = year * 12 + (monthNumber - 1) + delta
  return `${Math.floor(zeroBased / 12)}-${String((zeroBased % 12) + 1).padStart(2, '0')}`
}

/**
 * due_day の次の到来日(today を含む)。
 * 31日の支払いは、31日が無い月では月末に丸める(既存 projectCashflow と同じ規則)。
 */
export function nextDueDate(dueDay: number, today: string): string {
  const month = today.slice(0, 7)
  const clampedDay = Math.min(Math.max(dueDay, 1), daysInMonth(month))
  const thisMonth = `${month}-${String(clampedDay).padStart(2, '0')}`
  if (thisMonth >= today) return thisMonth

  const nextMonth = addMonthToMonthString(month, 1)
  const nextDay = Math.min(Math.max(dueDay, 1), daysInMonth(nextMonth))
  return `${nextMonth}-${String(nextDay).padStart(2, '0')}`
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.POSITIVE_INFINITY
  return Math.round((end - start) / 86400000)
}

export function buildUpcomingDebits(
  sources: DebitSource[],
  options: { today: string; horizonDays?: number }
): UpcomingDebit[] {
  const horizon = options.horizonDays ?? 14

  return sources
    .filter(source => source.is_active && source.type !== 'income' && yen(source.amount) > 0)
    .map<UpcomingDebit>(source => ({
      date: source.scheduled_date || nextDueDate(source.due_day, options.today),
      name: source.name,
      amount: yen(source.amount),
      accountId: source.debit_account_id ?? null,
    }))
    .filter(debit => {
      const days = daysBetween(options.today, debit.date)
      return days >= 0 && days <= horizon
    })
    .sort((a, b) => (a.date === b.date ? b.amount - a.amount : a.date < b.date ? -1 : 1))
}
