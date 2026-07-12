'use client'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  addMonths,
  format,
  startOfMonth,
  subMonths,
  subYears,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TransactionsResponse, CATEGORIES, INCOME_CATEGORIES } from '@/types/transaction'
import { ScheduledPayment } from '@/types/cashflow'
import TransactionList from '@/components/TransactionList'
import TransactionForm from '@/components/TransactionForm'
import ChatInput from '@/components/ChatInput'
import PaymentMethodSummaryCard from '@/components/PaymentMethodSummaryCard'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type PeriodKey = 'thisMonth' | 'lastMonth' | 'threeMonths' | 'year'
type ChartMode = 'monthly' | 'category'
type InputMode = 'form' | 'chat'

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'year', label: '過去1年' },
  { key: 'threeMonths', label: '過去3ヶ月' },
  { key: 'thisMonth', label: '今月' },
  { key: 'lastMonth', label: '先月' },
]

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
  '#14B8A6',
  '#F97316',
]

function periodRange(period: PeriodKey) {
  const today = new Date()
  const thisMonth = startOfMonth(today)

  if (period === 'lastMonth') {
    const start = subMonths(thisMonth, 1)
    return { start, end: thisMonth }
  }

  if (period === 'threeMonths') {
    return { start: subMonths(thisMonth, 2), end: addMonths(thisMonth, 1) }
  }

  if (period === 'year') {
    return { start: subYears(addMonths(thisMonth, 1), 1), end: addMonths(thisMonth, 1) }
  }

  return { start: thisMonth, end: addMonths(thisMonth, 1) }
}

function monthKey(date: string) {
  return date.slice(0, 7)
}

export default function TransactionsPage() {
  const [period, setPeriod] = useState<PeriodKey>('thisMonth')
  const [chartMode, setChartMode] = useState<ChartMode>('monthly')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [activeIssuer, setActiveIssuer] = useState<string | null>(null)
  const [showInput, setShowInput] = useState(false)
  const [inputMode, setInputMode] = useState<InputMode>('form')

  const range = periodRange(period)
  const start = format(range.start, 'yyyy-MM-dd')
  const end = format(range.end, 'yyyy-MM-dd')

  const { data, mutate } = useSWR<TransactionsResponse>(
    `/api/transactions?start=${start}&end=${end}`,
    fetcher
  )
  const { data: scheduledPayments } = useSWR<ScheduledPayment[]>('/api/scheduled-payments', fetcher)

  const allTransactions = useMemo(() => data?.transactions ?? [], [data?.transactions])
  const issuerOptions = useMemo(() => {
    return Array.from(new Set(allTransactions.map(tx => tx.card_issuer).filter(Boolean))) as string[]
  }, [allTransactions])

  const transactions = allTransactions.filter(tx => {
    if (activeCategory && tx.category !== activeCategory) return false
    if (activeIssuer && (tx.card_issuer ?? '不明') !== activeIssuer) return false
    return true
  })

  const expenseTotal = transactions.filter(t => t.kind !== 'income').reduce((sum, t) => sum + t.amount, 0)
  const incomeTotal = transactions.filter(t => t.kind === 'income').reduce((sum, t) => sum + t.amount, 0)
  const categoryTotal = allTransactions.filter(t => t.kind !== 'income').reduce((sum, t) => sum + t.amount, 0)

  const monthlyData = useMemo(() => {
    const map = new Map<string, { label: string; income: number; expense: number }>()
    for (const tx of allTransactions) {
      const key = monthKey(tx.date)
      const entry = map.get(key) ?? { label: key, income: 0, expense: 0 }
      if (tx.kind === 'income') entry.income += tx.amount
      else entry.expense += tx.amount
      map.set(key, entry)
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [allTransactions])

  const categoryData = useMemo(() => {
    const map = new Map<string, number>()
    for (const tx of allTransactions) {
      if (tx.kind === 'income') continue
      map.set(tx.category, (map.get(tx.category) ?? 0) + tx.amount)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount], index) => ({
        category,
        amount,
        percentage: categoryTotal > 0 ? Math.round((amount / categoryTotal) * 100) : 0,
        icon: CATEGORIES.find(c => c.name === category)?.icon ?? '📦',
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      }))
  }, [allTransactions, categoryTotal])

  const dailyData = useMemo(() => {
    const map = new Map<string, { label: string; income: number; expense: number }>()
    for (const tx of allTransactions) {
      const key = tx.date.slice(5).replace('-', '/')
      const entry = map.get(key) ?? { label: key, income: 0, expense: 0 }
      if (tx.kind === 'income') entry.income += tx.amount
      else entry.expense += tx.amount
      map.set(key, entry)
    }
    return Array.from(map.values())
  }, [allTransactions])

  return (
    <div className="mx-auto max-w-xl lg:max-w-4xl">
      <div className="sticky top-0 z-10 border-b border-border bg-background px-4 pb-3 pt-6 lg:static lg:border-0 lg:bg-transparent lg:px-0 lg:pt-0">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">収支</h1>
            <p className="mt-1 text-xs text-muted">
              {format(range.start, 'yyyy年M月d日', { locale: ja })} - {format(addMonths(range.end, 0), 'yyyy年M月d日', { locale: ja })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted">表示中</p>
            <p className="font-mono text-sm font-bold">{transactions.length}件</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4 lg:px-0">
        <div className="flex gap-2 overflow-x-auto">
          {PERIODS.map(item => (
            <FilterChip
              key={item.key}
              label={item.label}
              active={period === item.key}
              onClick={() => {
                setPeriod(item.key)
                setActiveCategory(null)
              }}
            />
          ))}
        </div>

        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold">収支グラフ</h2>
              <p className="mt-0.5 text-xs text-muted">期間フィルタと連動します</p>
            </div>
            <div className="grid grid-cols-2 rounded-xl bg-surface p-1">
              <button
                type="button"
                onClick={() => setChartMode('monthly')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${chartMode === 'monthly' ? 'bg-card text-foreground shadow-sm' : 'text-muted'}`}
              >
                月別
              </button>
              <button
                type="button"
                onClick={() => setChartMode('category')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${chartMode === 'category' ? 'bg-card text-foreground shadow-sm' : 'text-muted'}`}
              >
                カテゴリ
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <SummaryBox label="支出" value={expenseTotal} tone="danger" />
            <SummaryBox label="収入" value={incomeTotal} tone="success" />
          </div>

          <div className={chartMode === 'category' ? 'grid gap-4 lg:grid-cols-[260px_1fr]' : 'h-[230px]'}>
            {!data ? (
              <div className="skeleton h-full w-full rounded-xl" />
            ) : chartMode === 'monthly' ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={period === 'thisMonth' ? dailyData : monthlyData}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={period === 'thisMonth' ? 3 : 0} />
                  <YAxis tick={{ fontSize: 10 }} width={42} tickFormatter={v => Number(v) >= 10000 ? `${Math.round(Number(v) / 10000)}万` : String(v)} />
                  <Tooltip formatter={(value, name) => [`${Number(value).toLocaleString()}円`, name === 'income' ? '収入' : '支出']} />
                  <Bar dataKey="income" fill="#1FAE8C" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" fill="#E2544B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : categoryData.length > 0 ? (
              <>
                <div className="relative h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        dataKey="amount"
                        nameKey="category"
                        innerRadius={54}
                        outerRadius={86}
                        paddingAngle={2}
                        onClick={(_, index) => {
                          const selected = categoryData[index]
                          if (selected) setActiveCategory(selected.category)
                        }}
                      >
                        {categoryData.map(d => (
                          <Cell key={d.category} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value, name) => [`${Number(value).toLocaleString()}円`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs text-muted">支出</span>
                    <span className="font-mono text-lg font-bold">
                      {categoryTotal >= 10000 ? `${Math.round(categoryTotal / 10000)}万` : categoryTotal.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-muted">円</span>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  {categoryData.slice(0, 8).map(item => (
                    <button
                      type="button"
                      key={item.category}
                      onClick={() => setActiveCategory(item.category)}
                      className={`rounded-xl border px-3 py-2 text-left transition-base active:opacity-80 ${
                        activeCategory === item.category ? 'border-primary bg-primary/10' : 'border-border bg-surface'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                        <span className="shrink-0">{item.icon}</span>
                        <span className="min-w-0 flex-1 truncate font-bold">{item.category}</span>
                        <span className="shrink-0 text-muted">{item.percentage}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-card">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(item.percentage, 3)}%`, backgroundColor: item.color }}
                        />
                      </div>
                      <p className="mt-1 text-right font-mono text-xs font-bold">{item.amount.toLocaleString()}円</p>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">支出データがありません</div>
            )}
          </div>
        </section>

        <PaymentMethodSummaryCard transactions={allTransactions} scheduledPayments={scheduledPayments ?? []} />

        <div className="flex gap-2 overflow-x-auto">
          <FilterChip label="すべて" active={activeCategory === null} onClick={() => setActiveCategory(null)} />
          {[...CATEGORIES, ...INCOME_CATEGORIES].map(c => (
            <FilterChip
              key={c.name}
              label={`${c.icon} ${c.name}`}
              active={activeCategory === c.name}
              onClick={() => setActiveCategory(c.name)}
            />
          ))}
        </div>

        {issuerOptions.length > 0 && (
          <div className="flex gap-2 overflow-x-auto">
            <FilterChip label="カードすべて" active={activeIssuer === null} onClick={() => setActiveIssuer(null)} />
            {issuerOptions.map(issuer => (
              <FilterChip
                key={issuer}
                label={issuer}
                active={activeIssuer === issuer}
                onClick={() => setActiveIssuer(issuer)}
              />
            ))}
          </div>
        )}

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

      <button
        type="button"
        onClick={() => setShowInput(true)}
        className="fixed bottom-[calc(64px+env(safe-area-inset-bottom,0px)+16px)] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-white shadow-lg transition-base active:scale-95 lg:bottom-6"
        aria-label="取引を追加"
      >
        ＋
      </button>

      {showInput && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 px-4 py-6 backdrop-blur-[2px]"
          onClick={() => setShowInput(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[calc(100svh-48px)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-4">
              <div>
                <h2 className="text-base font-bold">取引を追加</h2>
                <p className="mt-0.5 text-xs text-muted">自動連携されない項目を手入力します</p>
              </div>
              <button
                type="button"
                onClick={() => setShowInput(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted transition-base active:bg-surface"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-surface p-2">
              {(['form', 'chat'] as InputMode[]).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setInputMode(mode)}
                  className={`rounded-xl py-2 text-sm font-bold ${inputMode === mode ? 'bg-card text-foreground shadow-sm' : 'text-muted'}`}
                >
                  {mode === 'form' ? 'フォーム' : 'チャット'}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto">
              {inputMode === 'form' ? (
                <TransactionForm onSuccess={() => { mutate(); setShowInput(false) }} />
              ) : (
                <ChatInput onSuccess={() => { mutate(); setShowInput(false) }} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

function SummaryBox({ label, value, tone }: { label: string; value: number; tone: 'danger' | 'success' }) {
  return (
    <div className="rounded-xl bg-surface p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${tone === 'danger' ? 'text-danger' : 'text-success'}`}>
        {value.toLocaleString()}円
      </p>
    </div>
  )
}
