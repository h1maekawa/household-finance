'use client'

import Link from 'next/link'
import { addMonths, format, getDaysInMonth } from 'date-fns'
import { ScheduledPayment } from '@/types/cashflow'
import { Transaction } from '@/types/transaction'

type Props = {
  transactions: Transaction[]
  scheduledPayments: ScheduledPayment[]
}

type MethodSummary = {
  name: string
  amount: number
  count: number
  schedule?: ScheduledPayment
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[\s　・]/g, '')
}

function findSchedule(method: string, payments: ScheduledPayment[]) {
  const normalizedMethod = normalizeName(method)
  return payments.find(payment => {
    if (payment.type !== 'credit') return false
    const normalizedPayment = normalizeName(payment.name)
    return normalizedMethod.includes(normalizedPayment) || normalizedPayment.includes(normalizedMethod)
  })
}

function getNextPaymentDate(dueDay: number) {
  const today = new Date()
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), Math.min(dueDay, getDaysInMonth(today)))
  const target = thisMonth >= today ? thisMonth : addMonths(thisMonth, 1)
  return format(target, 'M/d')
}

function isDeferredMethod(name: string, schedule?: ScheduledPayment) {
  const normalized = normalizeName(name)
  return Boolean(schedule) || normalized.includes('カード') || normalized.includes('credit')
}

export default function PaymentMethodSummaryCard({ transactions, scheduledPayments }: Props) {
  const expenseTransactions = transactions.filter(tx => tx.kind !== 'income')
  const summaries = new Map<string, MethodSummary>()

  for (const tx of expenseTransactions) {
    const name = tx.payment_method || '未設定'
    const current = summaries.get(name) ?? {
      name,
      amount: 0,
      count: 0,
      schedule: findSchedule(name, scheduledPayments),
    }
    current.amount += tx.amount
    current.count += 1
    summaries.set(name, current)
  }

  for (const payment of scheduledPayments.filter(payment => payment.type === 'credit')) {
    if ([...summaries.values()].some(summary => summary.schedule?.id === payment.id)) continue
    summaries.set(payment.name, {
      name: payment.name,
      amount: 0,
      count: 0,
      schedule: payment,
    })
  }

  const items = [...summaries.values()].sort((a, b) => {
    const aDeferred = isDeferredMethod(a.name, a.schedule)
    const bDeferred = isDeferredMethod(b.name, b.schedule)
    if (aDeferred !== bDeferred) return aDeferred ? -1 : 1
    return b.amount - a.amount
  })

  if (items.length === 0) return null

  const deferredTotal = items
    .filter(item => isDeferredMethod(item.name, item.schedule))
    .reduce((sum, item) => sum + item.amount, 0)

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">支払い方法別の利用状況</p>
          <p className="mt-1 text-xs text-muted">今月の利用額と登録済みの引き落とし日</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-bold text-danger">{deferredTotal.toLocaleString()}円</p>
          <p className="mt-0.5 text-[10px] text-muted">後払い分</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {items.map(item => {
          const deferred = isDeferredMethod(item.name, item.schedule)
          return (
            <div key={item.name} className="rounded-xl bg-surface px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{item.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {item.count > 0 ? `${item.count}件利用` : '今月の利用なし'}
                    {deferred && item.schedule && ` ・ 次回 ${getNextPaymentDate(item.schedule.due_day)}`}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-sm font-bold">
                  {item.amount.toLocaleString()}円
                </p>
              </div>
              {deferred && !item.schedule && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-warning/10 px-2.5 py-2">
                  <p className="text-[11px] text-warning">引き落とし日が未設定です</p>
                  <Link href="/plan?tab=payments" className="shrink-0 text-[11px] font-bold text-warning">
                    設定する
                  </Link>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
