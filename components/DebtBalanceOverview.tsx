'use client'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Debt } from '@/types/debt'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function DebtBalanceOverview() {
  const { data: debts } = useSWR<Debt[]>('/api/debts', fetcher)
  const [showDetails, setShowDetails] = useState(false)

  const activeDebts = (debts ?? []).filter(debt => !debt.is_settled)
  const borrowed = activeDebts.filter(debt => debt.direction === 'borrowed')
  const lent = activeDebts.filter(debt => debt.direction === 'lent')
  const borrowedTotal = borrowed.reduce((sum, debt) => sum + debt.amount, 0)
  const lentTotal = lent.reduce((sum, debt) => sum + debt.amount, 0)
  const chartData = [
    { name: '借りている', value: borrowedTotal, color: '#E2544B' },
    { name: '貸している', value: lentTotal, color: '#1FAE8C' },
  ].filter(item => item.value > 0)

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">貸借管理</h2>
          <p className="mt-1 text-xs text-muted">借りているお金・貸しているお金</p>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails(true)}
          className="shrink-0 text-xs font-bold text-primary"
        >
          詳細
        </button>
      </div>

      {chartData.length > 0 ? (
        <div className="grid grid-cols-[130px_1fr] items-center gap-3">
          <div className="h-[130px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={38} outerRadius={58} paddingAngle={3}>
                  {chartData.map(item => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip formatter={(value) => `${Number(value).toLocaleString()}円`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid gap-2">
            <DebtTotal label="借りている" value={borrowedTotal} tone="danger" />
            <DebtTotal label="貸している" value={lentTotal} tone="success" />
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-muted">
          貸し借りはありません
        </div>
      )}

      {showDetails && (
        <DebtDetailsModal
          debts={activeDebts}
          onClose={() => setShowDetails(false)}
        />
      )}
    </div>
  )
}

function DebtTotal({ label, value, tone }: { label: string; value: number; tone: 'danger' | 'success' }) {
  return (
    <div className="rounded-xl bg-surface p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`mt-1 font-mono text-sm font-bold ${tone === 'danger' ? 'text-danger' : 'text-success'}`}>
        {value.toLocaleString()}円
      </p>
    </div>
  )
}

function DebtDetailsModal({ debts, onClose }: { debts: Debt[]; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 px-4 py-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[calc(100svh-48px)] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 className="text-base font-bold">貸借メモ</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted transition-base active:bg-surface"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {debts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">表示する貸し借りはありません</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border">
              {debts.map((debt, index) => (
                <div key={debt.id} className={`px-4 py-3 ${index < debts.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{debt.counterparty}</p>
                      <p className="mt-0.5 text-xs text-muted">{debt.date}{debt.memo ? ` ・ ${debt.memo}` : ''}</p>
                    </div>
                    <p className={`shrink-0 font-mono text-sm font-bold ${debt.direction === 'borrowed' ? 'text-danger' : 'text-success'}`}>
                      {debt.amount.toLocaleString()}円
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
