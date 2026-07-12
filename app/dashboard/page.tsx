'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { format, addMonths, startOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import Link from 'next/link'
import AlertBanner from '@/components/AlertBanner'
import DebtsSummaryCard from '@/components/DebtsSummaryCard'
import PaymentMethodSummaryCard from '@/components/PaymentMethodSummaryCard'
import SignOutButton from '@/components/SignOutButton'
import TransactionList from '@/components/TransactionList'
import { ScheduledPayment } from '@/types/cashflow'
import { TransactionsResponse } from '@/types/transaction'
import { CATEGORIES, INCOME_CATEGORIES } from '@/types/transaction'

function categoryIcon(category: string) {
  return (
    CATEGORIES.find(c => c.name === category)?.icon ??
    INCOME_CATEGORIES.find(c => c.name === category)?.icon ??
    '📦'
  )
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

const CATEGORY_COLORS = [
  '#1476B3',
  '#1FAE8C',
  '#E2544B',
  '#F0B429',
  '#7C5CFF',
  '#EF7B45',
  '#2F80ED',
  '#6B7280',
  '#9B51E0',
]

export default function DashboardPage() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const year  = month.getFullYear()
  const mo    = month.getMonth() + 1

  const { data, mutate } = useSWR<TransactionsResponse>(
    `/api/transactions?year=${year}&month=${mo}`,
    fetcher
  )
  const { data: analysis } = useSWR(
    `/api/analysis/fixed-variable?year=${year}&month=${mo}`,
    fetcher
  )
  const { data: investments } = useSWR('/api/investments', fetcher)
  const { data: cashflow } = useSWR('/api/cashflow', fetcher)
  const { data: scheduledPayments } = useSWR<ScheduledPayment[]>('/api/scheduled-payments', fetcher)

  const transactions = data?.transactions ?? []
  const summary      = data?.summary ?? { total: 0, expense_total: 0, income_total: 0, by_category: {} }
  const reviewCount  = transactions.filter(tx => tx.needs_review).length
  const expenseTransactions = transactions.filter(tx => tx.kind !== 'income')
  const filteredExpenseTransactions = activeCategory
    ? expenseTransactions.filter(tx => tx.category === activeCategory)
    : expenseTransactions

  const categoryTotal = summary.expense_total || summary.total || 0
  const chartData = Object.entries(summary.by_category)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount], index) => ({
      category,
      amount,
      percentage: categoryTotal > 0 ? Math.round((amount / categoryTotal) * 100) : 0,
      icon: CATEGORIES.find(c => c.name === category)?.icon ?? '📦',
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    }))
  const topCategory = chartData[0]

  const recentFive = transactions.slice(0, 5)
  const cashBalance = Number(cashflow?.currentBalance?.balance ?? 0)
  const investmentValue = Number(investments?.summary?.investmentValue ?? 0)
  const totalAssets = cashBalance + investmentValue
  const assetChartData = Array.from({ length: 6 }).map((_, index) => {
    const date = addMonths(month, index - 5)
    return {
      label: format(date, 'M月', { locale: ja }),
      cash: cashBalance,
      investment: investmentValue,
      total: totalAssets,
    }
  })

  function fmt(v: number) {
    if (v >= 10000) return `${Math.floor(v / 10000)}万${v % 10000 > 0 ? `${v % 10000}` : ''}`
    return v.toLocaleString()
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="bg-primary text-white px-4 pt-5 pb-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold leading-none">Flow<span className="text-white/70">+</span></p>
            <p className="mt-1 text-xs text-white/70">{format(new Date(), 'M月d日 EEEE', { locale: ja })}</p>
          </div>
          <SignOutButton />
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setMonth(m => addMonths(m, -1))}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 text-white text-lg"
          >
            ‹
          </button>
          <h1 className="text-base font-medium">
            {format(month, 'yyyy年M月', { locale: ja })}
          </h1>
          <button
            onClick={() => setMonth(m => addMonths(m, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 text-white text-lg"
          >
            ›
          </button>
        </div>
        <div className="mt-3 text-center">
          <p className="text-white/70 text-xs mb-1">今月の支出</p>
          {!data ? (
            <div className="skeleton h-10 w-48 mx-auto" />
          ) : (
            <p className="text-3xl font-bold">{summary.total.toLocaleString()}<span className="text-base ml-1">円</span></p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4">
        <div className="grid grid-cols-2 rounded-xl bg-white p-1">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`rounded-lg py-2 text-sm font-bold transition-base ${
              activeTab === 'overview' ? 'bg-primary text-white' : 'text-muted'
            }`}
          >
            概要
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`rounded-lg py-2 text-sm font-bold transition-base ${
              activeTab === 'history' ? 'bg-primary text-white' : 'text-muted'
            }`}
          >
            支出履歴
          </button>
        </div>

        {activeTab === 'overview' ? (
          <>
        <div className="card p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold">資産サマリー</h2>
              <p className="mt-1 text-xs text-muted">総資産・現金預金・投資評価額</p>
            </div>
            <Link href="/investments" className="shrink-0 text-xs font-bold text-primary">詳細</Link>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <AssetMini label="総資産" value={totalAssets} />
            <AssetMini label="現金預金" value={cashBalance} />
            <AssetMini label="投資評価額" value={investmentValue} />
          </div>
          <div className="mt-4 h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={assetChartData}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={42} tickFormatter={v => Number(v) >= 10000 ? `${Math.round(Number(v) / 10000)}万` : String(v)} />
                <Tooltip formatter={(value, name) => [`${Number(value).toLocaleString()}円`, name === 'cash' ? '現金預金' : name === 'investment' ? '投資評価額' : '総資産']} />
                <Area type="monotone" dataKey="cash" stackId="1" stroke="#1476B3" fill="#1476B3" fillOpacity={0.28} />
                <Area type="monotone" dataKey="investment" stackId="1" stroke="#1FAE8C" fill="#1FAE8C" fillOpacity={0.28} />
                <Area type="monotone" dataKey="total" stroke="#E2544B" fill="transparent" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 貸し借り・未納(一番最初に表示) */}
        <DebtsSummaryCard />

        <PaymentMethodSummaryCard transactions={transactions} scheduledPayments={scheduledPayments ?? []} />

        {reviewCount > 0 && (
          <Link href="/transactions" className="card border border-warning/30 p-4 block active:opacity-80">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold">確認が必要な取引があります</p>
                <p className="text-xs text-muted mt-1">金額を見ながらカテゴリやメモを入力できます</p>
              </div>
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-bold text-warning shrink-0">
                {reviewCount}件
              </span>
            </div>
          </Link>
        )}

        {/* Alerts */}
        {analysis?.alerts?.length > 0 && (
          <AlertBanner alerts={analysis.alerts} />
        )}

        <Link href="/settings" className="card p-4 block active:opacity-80">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold">設定</p>
              <p className="text-xs text-muted mt-1">初期残高・毎月の収入を変更できます</p>
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
                <p className="text-xs text-muted mt-1">保有銘柄の時価総額(自動更新)</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold ${investments.summary.dayPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                  {investments.summary.dayPnl >= 0 ? '+' : ''}
                  {investments.summary.dayPnl.toLocaleString()}円
                </p>
                <p className="text-xs text-muted mt-1">本日の投資損益</p>
              </div>
            </div>
          </Link>
        )}

        {/* Category Chart */}
        {chartData.length > 0 && (
          <div className="card p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="font-bold text-base">カテゴリ別支出</h2>
                <p className="text-xs text-muted mt-1">今月の使い道の割合</p>
              </div>
              {topCategory && (
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted">一番多い</p>
                  <p className="text-sm font-bold">
                    {topCategory.icon} {topCategory.category}
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-[150px_1fr] gap-4 items-center">
              <div className="relative h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="amount"
                      nameKey="category"
                      innerRadius={46}
                      outerRadius={68}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {chartData.map(d => (
                        <Cell key={d.category} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => [`${Number(v).toLocaleString()}円`]}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xs text-muted">合計</span>
                  <span className="text-lg font-bold">{fmt(categoryTotal)}</span>
                  <span className="text-[10px] text-muted">円</span>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                {chartData.slice(0, 5).map(d => (
                  <div key={d.category} className="min-w-0">
                    <div className="mb-1 flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="shrink-0">{d.icon}</span>
                      <span className="truncate font-medium">{d.category}</span>
                      <span className="ml-auto shrink-0 text-muted">{d.percentage}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(d.percentage, 3)}%`, backgroundColor: d.color }}
                      />
                    </div>
                    <p className="mt-0.5 text-right text-xs font-bold">
                      {d.amount.toLocaleString()}円
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {chartData.length > 5 && (
              <p className="mt-3 text-right text-xs text-muted">
                他 {chartData.length - 5}カテゴリ
              </p>
            )}
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
            <Link href="/transactions" className="text-sm text-primary">収支で見る →</Link>
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
              <Link href="/transactions" className="mt-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium">
                収支を開く
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
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted mb-1">この月の支出</p>
                  <p className="text-2xl font-bold">
                    {summary.expense_total.toLocaleString()}
                    <span className="text-sm font-normal text-muted ml-1">円</span>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted mb-1">表示中</p>
                  <p className="text-sm font-bold">{filteredExpenseTransactions.length}件</p>
                </div>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto">
              <HistoryFilterChip
                label="すべて"
                active={activeCategory === null}
                onClick={() => setActiveCategory(null)}
              />
              {CATEGORIES.map(c => (
                <HistoryFilterChip
                  key={c.name}
                  label={`${c.icon} ${c.name}`}
                  active={activeCategory === c.name}
                  onClick={() => setActiveCategory(c.name)}
                />
              ))}
            </div>

            {!data ? (
              <div className="card overflow-hidden">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex gap-3 px-4 py-3 border-b border-border last:border-0">
                    <div className="skeleton w-9 h-9 rounded-[10px]" />
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="skeleton h-4 w-3/4 rounded" />
                      <div className="skeleton h-3 w-1/2 rounded" />
                    </div>
                    <div className="skeleton h-5 w-16 rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <TransactionList transactions={filteredExpenseTransactions} onMutate={() => mutate()} />
            )}
          </div>
        )}

        {/* Quick Add Button */}
        <Link
          href="/transactions"
          className="fixed bottom-[calc(64px+env(safe-area-inset-bottom,0px)+16px)] right-4 w-14 h-14 rounded-full bg-primary text-white text-2xl flex items-center justify-center shadow-lg transition-base active:scale-95 lg:hidden"
        >
          ＋
        </Link>
      </div>
    </div>
  )
}

function HistoryFilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition-base ${
        active ? 'border-primary bg-primary text-white' : 'border-border bg-card text-muted'
      }`}
    >
      {label}
    </button>
  )
}

function AssetMini({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface p-2.5">
      <p className="truncate text-[11px] text-muted">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-bold">{value.toLocaleString()}円</p>
    </div>
  )
}
