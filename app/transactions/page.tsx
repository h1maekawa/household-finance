'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { format, addMonths, startOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { TransactionsResponse } from '@/types/transaction'
import TransactionList from '@/components/TransactionList'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function TransactionsPage() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const year = month.getFullYear()
  const mo   = month.getMonth() + 1

  const { data, mutate } = useSWR<TransactionsResponse>(
    `/api/transactions?year=${year}&month=${mo}`,
    fetcher
  )

  const transactions = data?.transactions ?? []
  const total = data?.summary?.total ?? 0

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border z-10 px-4 pt-8 pb-3">
        <h1 className="text-xl font-bold mb-3">取引履歴</h1>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setMonth(m => addMonths(m, -1))}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-surface text-foreground text-lg"
          >
            ‹
          </button>
          <div className="text-center">
            <p className="text-sm font-medium">{format(month, 'yyyy年M月', { locale: ja })}</p>
            {data && (
              <p className="text-xs text-muted">合計 {total.toLocaleString()}円 · {transactions.length}件</p>
            )}
          </div>
          <button
            onClick={() => setMonth(m => addMonths(m, 1))}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-surface text-foreground text-lg"
          >
            ›
          </button>
        </div>
      </div>

      <div className="px-4 pt-4">
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
