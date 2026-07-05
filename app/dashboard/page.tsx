'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { format, addMonths, startOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { TransactionsResponse } from '@/types/transaction'
import { CATEGORIES, INCOME_CATEGORIES } from '@/types/transaction'

function categoryIcon(category: string) {
  return (
    CATEGORIES.find(c => c.name === category)?.icon ??
    INCOME_CATEGORIES.find(c => c.name === category)?.icon ??
    '📦'
  )
}
import AlertBanner from '@/components/AlertBanner'
import Link from 'next/link'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function DashboardPage() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const year  = month.getFullYear()
  const mo    = month.getMonth() + 1

  const { data } = useSWR<TransactionsResponse>(
    `/api/transactions?year=${year}&month=${mo}`,
    fetcher
  )
  const { data: analysis } = useSWR(
    `/api/analysis/fixed-variable?year=${year}&month=${mo}`,
    fetcher
  )
  const { data: investments } = useSWR('/api/investments', fetcher)

  const transactions = data?.transactions ?? []
  const summary      = data?.summary ?? { total: 0, expense_total: 0, income_total: 0, by_category: {} }

  const chartData = Object.entries(summary.by_category)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({
      category,
      amount,
      icon: CATEGORIES.find(c => c.name === category)?.icon ?? '📦',
    }))

  const recentFive = transactions.slice(0, 5)

  function fmt(v: number) {
    if (v >= 10000) return `${Math.floor(v / 10000)}万${v % 10000 > 0 ? `${v % 10000}` : ''}`
    return v.toLocaleString()
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="bg-primary text-white px-4 pt-10 pb-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setMonth(m => addMonths(m, -1))}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white text-lg"
          >
            ‹
          </button>
          <h1 className="text-base font-medium">
            {format(month, 'yyyy年M月', { locale: ja })}
          </h1>
          <button
            onClick={() => setMonth(m => addMonths(m, 1))}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white text-lg"
          >
            ›
          </button>
        </div>
        <div className="text-center">
          <p className="text-white/70 text-sm mb-1">今月の支出</p>
          {!data ? (
            <div className="skeleton h-10 w-48 mx-auto" />
          ) : (
            <p className="text-4xl font-bold">{summary.total.toLocaleString()}<span className="text-xl ml-1">円</span></p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4">
        {/* Alerts */}
        {analysis?.alerts?.length > 0 && (
          <AlertBanner alerts={analysis.alerts} />
        )}

        <Link href="/flow/setup" className="card p-4 block active:opacity-80">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold">Flow+ 初期設定</p>
              <p className="text-xs text-muted mt-1">ログインから残高・収入・固定費・カード締め日まで</p>
            </div>
            <span className="text-primary text-sm font-bold shrink-0">開く →</span>
          </div>
        </Link>

        {/* Investment Assets */}
        {investments?.summary && (
          <Link href="/investments" className="card p-4 block active:opacity-80">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted mb-1">資産合計</p>
                <p className="text-2xl font-bold">
                  {investments.summary.investmentValue.toLocaleString()}
                  <span className="text-sm font-normal text-muted ml-1">円</span>
                </p>
                <p className="text-xs text-muted mt-1">現金 + 投資評価額のうち、投資評価額を連携中</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold ${investments.summary.dayPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                  {investments.summary.dayPnl >= 0 ? '+' : ''}
                  {investments.summary.dayPnl.toLocaleString()}円
                </p>
                <p className="text-xs text-muted mt-1">本日の投資損益</p>
                <p className="text-xs text-warning mt-2">重要 {investments.summary.unreadHighImportanceNews}件</p>
              </div>
            </div>
          </Link>
        )}

        {/* Category Chart */}
        {chartData.length > 0 && (
          <div className="card p-4">
            <h2 className="font-bold text-base mb-3">カテゴリ別支出</h2>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6EAEF" />
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 9 }}
                  tickFormatter={(_v, i) => chartData[i]?.icon ?? ''}
                />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={fmt} />
                <Tooltip
                  formatter={(v) => [`${Number(v).toLocaleString()}円`]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.category ?? ''}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="amount" fill="#1476B3" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="grid grid-cols-3 gap-1 mt-2">
              {chartData.map(d => (
                <div key={d.category} className="flex items-center gap-1 text-xs text-muted">
                  <span>{d.icon}</span>
                  <span className="truncate">{d.category}</span>
                  <span className="ml-auto font-medium text-foreground shrink-0">
                    {d.amount >= 10000 ? `${Math.floor(d.amount / 1000)}k` : d.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fixed vs Variable */}
        {analysis && (
          <div className="card p-4">
            <h2 className="font-bold text-base mb-3">固定費 / 変動費</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface rounded-xl p-3">
                <p className="text-xs text-muted mb-1">固定費</p>
                <p className="text-lg font-bold">{analysis.fixed?.total?.toLocaleString() ?? 0}円</p>
                {analysis.fixed?.change_rate !== 0 && (
                  <p className={`text-xs mt-1 ${analysis.fixed?.change_rate > 0 ? 'text-danger' : 'text-success'}`}>
                    {analysis.fixed?.change_rate > 0 ? '↑' : '↓'}
                    {Math.abs(Math.round((analysis.fixed?.change_rate ?? 0) * 100))}% 先月比
                  </p>
                )}
              </div>
              <div className="bg-surface rounded-xl p-3">
                <p className="text-xs text-muted mb-1">変動費</p>
                <p className="text-lg font-bold">{analysis.variable?.total?.toLocaleString() ?? 0}円</p>
                {analysis.variable?.change_rate !== 0 && (
                  <p className={`text-xs mt-1 ${analysis.variable?.change_rate > 0 ? 'text-danger' : 'text-success'}`}>
                    {analysis.variable?.change_rate > 0 ? '↑' : '↓'}
                    {Math.abs(Math.round((analysis.variable?.change_rate ?? 0) * 100))}% 先月比
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Recent Transactions */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-base">直近の取引</h2>
            <Link href="/transactions" className="text-sm text-primary">すべて見る →</Link>
          </div>

          {!data ? (
            <div className="card overflow-hidden">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex gap-3 px-4 py-3 border-b border-border last:border-0">
                  <div className="skeleton w-8 h-8 rounded-full" />
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="skeleton h-4 w-3/4 rounded" />
                    <div className="skeleton h-3 w-1/2 rounded" />
                  </div>
                  <div className="skeleton h-5 w-16 rounded" />
                </div>
              ))}
            </div>
          ) : recentFive.length === 0 ? (
            <div className="card flex flex-col items-center py-10 text-muted gap-2">
              <span className="text-4xl">📋</span>
              <p className="text-sm">まだデータがありません</p>
              <Link href="/input" className="mt-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium">
                入力する
              </Link>
            </div>
          ) : (
            <div className="card overflow-hidden">
              {recentFive.map((tx, i) => {
                const icon = categoryIcon(tx.category)
                const isIncome = tx.kind === 'income'
                return (
                  <div key={tx.id}
                    className={`flex items-center gap-3 px-4 py-3 ${i < recentFive.length - 1 ? 'border-b border-border' : ''}`}>
                    <span className="text-2xl">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{tx.memo || tx.category}</p>
                      <p className="text-xs text-muted">{tx.date} · {tx.payment_method}</p>
                    </div>
                    <p className={`text-sm font-bold shrink-0 ${isIncome ? 'text-success' : 'text-danger'}`}>
                      {isIncome ? '+' : '-'}{tx.amount.toLocaleString()}円
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Quick Add Button */}
        <Link
          href="/input"
          className="fixed bottom-[calc(64px+env(safe-area-inset-bottom,0px)+16px)] right-4 w-14 h-14 rounded-full bg-primary text-white text-2xl flex items-center justify-center shadow-lg transition-base active:scale-95 lg:hidden"
        >
          ＋
        </Link>
      </div>
    </div>
  )
}
