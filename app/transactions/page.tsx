'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { format, addMonths, startOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { TransactionsResponse, CATEGORIES } from '@/types/transaction'
import TransactionList from '@/components/TransactionList'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function TransactionsPage() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const year = month.getFullYear()
  const mo   = month.getMonth() + 1

  const { data, mutate } = useSWR<TransactionsResponse>(
    `/api/transactions?year=${year}&month=${mo}`,
    fetcher
  )

  const allTransactions = data?.transactions ?? []
  const transactions = activeCategory
    ? allTransactions.filter(t => t.category === activeCategory)
    : allTransactions
  const total = data?.summary?.total ?? 0

  return (
    <div className="mx-auto max-w-xl lg:max-w-3xl">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background px-4 pt-8 pb-3 lg:static lg:border-0 lg:bg-transparent lg:px-0 lg:pt-0">
        <h1 className="mb-3 text-xl font-bold">履歴</h1>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setMonth(m => addMonths(m, -1))}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-lg text-foreground"
          >
            ‹
          </button>
          <div className="text-center">
            <p className="text-sm font-medium">{format(month, 'yyyy年M月', { locale: ja })}</p>
            {data && (
              <p className="font-mono text-xs text-muted">合計 {total.toLocaleString()}円 ・ {transactions.length}件</p>
            )}
          </div>
          <button
            onClick={() => setMonth(m => addMonths(m, 1))}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-lg text-foreground"
          >
            ›
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 lg:px-0">
        {/* カテゴリフィルタ */}
        <div className="mb-4 flex gap-2 overflow-x-auto">
          <FilterChip label="すべて" active={activeCategory === null} onClick={() => setActiveCategory(null)} />
          {CATEGORIES.map(c => (
            <FilterChip
              key={c.name}
              label={`${c.icon} ${c.name}`}
              active={activeCategory === c.name}
              onClick={() => setActiveCategory(c.name)}
            />
          ))}
        </div>

        {!data ? (
          <div className="flex flex-col gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i}>
                <div className="skeleton h-4 w-24 rounded mb-2" />
                <div className="card overflow-hidden">
                  {[...Array(2)].map((_, j) => (
                    <div key={j} className="flex gap-3 px-4 py-3 border-b border-border last:border-0">
                      <div className="skeleton w-8 h-8 rounded-full" />
                      <div className="flex-1 flex flex-col gap-1">
                        <div className="skeleton h-4 w-3/4 rounded" />
                        <div className="skeleton h-3 w-1/2 rounded" />
                      </div>
                      <div className="skeleton h-5 w-16 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <TransactionList transactions={transactions} onMutate={() => mutate()} />
        )}
      </div>
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition-base ${
        active ? 'border-primary bg-primary text-white' : 'border-border text-muted'
      }`}
    >
      {label}
    </button>
  )
}
