'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { addMonths, endOfMonth, format, isWithinInterval, parseISO, startOfMonth } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CashflowResponse } from '@/types/cashflow'
import ScheduledPaymentList from '@/components/ScheduledPaymentList'
import { useToast } from '@/components/Toast'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function isImportedCardBill(name: string, memo?: string) {
  const text = `${name} ${memo ?? ''}`.toLowerCase()
  return text.includes('カード') || text.includes('card')
}

function formatAxis(value: number) {
  if (Math.abs(value) >= 10000) return `${Math.round(value / 10000)}万`
  return value.toLocaleString()
}

export default function CashflowPage() {
  const { showToast } = useToast()
  const { data, mutate } = useSWR<CashflowResponse>('/api/cashflow', fetcher)
  const { data: investments } = useSWR('/api/investments', fetcher)
  const [editingBalance, setEditingBalance] = useState(false)
  const [newBalance, setNewBalance] = useState('')
  const [saving, setSaving] = useState(false)

  const current = data?.currentBalance
  const projected = data?.projectedDays ?? []
  const payments  = data?.scheduledPayments ?? []
  const generatedPayments = data?.generatedPayments ?? []
  const creditCards = data?.creditCards ?? []
  const profile = data?.profile

  const targetMonthStart = startOfMonth(addMonths(new Date(), 1))
  const targetNextMonthStart = startOfMonth(addMonths(targetMonthStart, 1))
  const targetRangeEnd = endOfMonth(targetNextMonthStart)
  const focusedProjected = projected.filter(day => {
    const date = parseISO(day.date)
    return isWithinInterval(date, { start: targetMonthStart, end: targetRangeEnd })
  })
  const investmentValue = Number(investments?.summary?.investmentValue ?? 0)
  const currentCash = Number(current?.balance ?? 0)
  const minBalance = focusedProjected.length > 0 ? Math.min(...focusedProjected.map(d => d.balance)) : 0
  const negDays    = focusedProjected.filter(d => d.isNegative).length
  const totalOutflow = focusedProjected.reduce((sum, day) => {
    return sum + day.payments
      .filter(payment => payment.type !== 'income')
      .reduce((daySum, payment) => daySum + payment.amount, 0)
  }, 0)
  const totalIncome = focusedProjected.reduce((sum, day) => {
    return sum + day.payments
      .filter(payment => payment.type === 'income')
      .reduce((daySum, payment) => daySum + payment.amount, 0)
  }, 0)
  const additionalCashNeeded = Math.max(0, -minBalance)
  const usableCashAfterProjection = focusedProjected.length > 0 ? focusedProjected[focusedProjected.length - 1].balance : currentCash
  const confirmedCardBills = payments.filter(payment =>
    payment.source === 'gmail_bank' && Boolean(payment.scheduled_date) && isImportedCardBill(payment.name, payment.memo)
  )
  const upcomingCardBills = [...confirmedCardBills, ...generatedPayments]
    .slice()
    .filter(payment => {
      if (!payment.scheduled_date) return false
      const date = parseISO(payment.scheduled_date)
      return isWithinInterval(date, { start: targetMonthStart, end: targetRangeEnd })
    })
    .sort((a, b) => String(a.scheduled_date ?? '').localeCompare(String(b.scheduled_date ?? '')))
  const monthlyChartData = [targetMonthStart, targetNextMonthStart].map(monthStart => {
    const monthEnd = endOfMonth(monthStart)
    const days = focusedProjected.filter(day => {
      const date = parseISO(day.date)
      return isWithinInterval(date, { start: monthStart, end: monthEnd })
    })
    const endingCash = days.length > 0 ? days[days.length - 1].balance : currentCash
    const expense = days.reduce((sum, day) => {
      return sum + day.payments
        .filter(payment => payment.type !== 'income')
        .reduce((daySum, payment) => daySum + payment.amount, 0)
    }, 0)

    return {
      month: format(monthStart, 'M月'),
      totalAssets: Math.max(Math.round(endingCash + investmentValue), 0),
      cash: Math.max(Math.round(endingCash), 0),
      expense,
    }
  })

  async function handleBalanceSave() {
    const amount = parseInt(newBalance)
    if (isNaN(amount) || amount < 0) { showToast('正しい金額を入力してください', 'warning'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/cashflow/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: amount }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      showToast('残高を更新しました', 'success')
      setEditingBalance(false)
      setNewBalance('')
      mutate()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '更新に失敗しました', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="bg-primary text-white px-4 pt-10 pb-6">
        <h1 className="text-xl font-bold mb-1">預貯金キャッシュフロー</h1>
        <p className="mb-4 text-xs leading-relaxed text-white/70">
          投資資産は含めず、支払いに使える預貯金だけで不足しないかを確認します。
        </p>

        {/* Balance */}
        <div className="bg-white/10 rounded-2xl p-4">
          <p className="text-white/70 text-xs mb-1">現在の預貯金</p>
          {editingBalance ? (
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={newBalance}
                onChange={e => setNewBalance(e.target.value)}
                placeholder="金額を入力"
                className="flex-1 rounded-xl px-3 py-2 text-foreground text-sm bg-white"
                autoFocus
              />
              <button onClick={handleBalanceSave} disabled={saving}
                className="px-3 py-2 rounded-xl bg-success text-white text-sm font-medium disabled:opacity-50">
                {saving ? '...' : '保存'}
              </button>
              <button onClick={() => { setEditingBalance(false); setNewBalance('') }}
                className="px-3 py-2 rounded-xl bg-white/20 text-white text-sm">
                取消
              </button>
            </div>
          ) : (
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold">
                {current ? current.balance.toLocaleString() : '-'}
                <span className="text-base font-normal ml-1">円</span>
              </p>
              <button onClick={() => setEditingBalance(true)}
                className="px-3 py-1.5 rounded-xl bg-white/20 text-white text-xs font-medium">
                更新
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4">
        {data && (
          <div className="card p-4">
            <div className="mb-3">
              <h2 className="text-base font-bold">必要な預貯金</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {format(targetMonthStart, 'M月')}と{format(targetNextMonthStart, 'M月')}の支払い予定を、預貯金だけで払えるかを見ます。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className={`rounded-xl p-3 ${additionalCashNeeded > 0 ? 'bg-danger/10' : 'bg-success/10'}`}>
                <p className="text-[11px] text-muted">追加で必要な預貯金</p>
                <p className={`mt-1 text-lg font-bold ${additionalCashNeeded > 0 ? 'text-danger' : 'text-success'}`}>
                  {additionalCashNeeded.toLocaleString()}円
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {additionalCashNeeded > 0 ? 'この金額を補えば不足を回避' : '現時点では不足見込みなし'}
                </p>
              </div>
              <div className="rounded-xl bg-surface p-3">
                <p className="text-[11px] text-muted">予測後の預貯金</p>
                <p className={`mt-1 text-lg font-bold ${usableCashAfterProjection < 0 ? 'text-danger' : 'text-foreground'}`}>
                  {usableCashAfterProjection.toLocaleString()}円
                </p>
                <p className="mt-0.5 text-[11px] text-muted">投資評価額は含みません</p>
              </div>
              <div className="rounded-xl bg-surface p-3">
                <p className="text-[11px] text-muted">期間内の支払い予定</p>
                <p className="mt-1 text-sm font-bold text-danger">-{totalOutflow.toLocaleString()}円</p>
                <p className="mt-0.5 text-[11px] text-muted">カード・固定費・手動予定</p>
              </div>
              <div className="rounded-xl bg-surface p-3">
                <p className="text-[11px] text-muted">期間内の入金予定</p>
                <p className="mt-1 text-sm font-bold text-success">+{totalIncome.toLocaleString()}円</p>
                <p className="mt-0.5 text-[11px] text-muted">給与などの固定収入</p>
              </div>
            </div>
          </div>
        )}

        {/* Alerts */}
        {negDays > 0 && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-danger/10 text-danger border border-danger/20 text-sm font-medium">
            <span className="text-base mt-0.5">⚠</span>
            <p>{format(targetMonthStart, 'M月')}〜{format(targetNextMonthStart, 'M月')}で預貯金がマイナスになる日が <strong>{negDays}日</strong> あります（最小: {minBalance.toLocaleString()}円）</p>
          </div>
        )}

        {/* Chart */}
        {!data ? (
          <div className="card p-4">
            <div className="skeleton h-5 w-32 rounded mb-3" />
            <div className="skeleton h-48 w-full rounded-xl" />
          </div>
        ) : monthlyChartData.length > 0 ? (
          <div className="card p-4">
            <h2 className="font-bold text-base mb-1">
              {format(targetMonthStart, 'M月')}・{format(targetNextMonthStart, 'M月')}の月別見通し
            </h2>
            <p className="mb-3 text-xs leading-relaxed text-muted">
              各月末時点の総資産・現預貯金と、その月に支払う予定額を並べています。
            </p>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#D8DEE8" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6B7280' }} tickMargin={8} />
                  <YAxis tickFormatter={value => formatAxis(Number(value))} tick={{ fontSize: 11, fill: '#6B7280' }} width={46} />
                  <Tooltip
                    formatter={(value, name) => {
                      const labels: Record<string, string> = {
                        totalAssets: '総資産',
                        cash: '現預貯金',
                        expense: '支出',
                      }
                      return [`${Number(value).toLocaleString()}円`, labels[String(name)] ?? String(name)]
                    }}
                    contentStyle={{ fontSize: 12, borderRadius: 12, borderColor: '#D8DEE8' }}
                  />
                  <Legend formatter={value => ({ totalAssets: '総資産', cash: '現預貯金', expense: '支出' }[String(value)] ?? String(value))} />
                  <Bar dataKey="totalAssets" fill="#1476B3" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="cash" fill="#1FAE8C" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="expense" fill="#E2544B" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <LegendTile label="総資産" color="#1476B3" />
              <LegendTile label="現預貯金" color="#1FAE8C" />
              <LegendTile label="支出" color="#E2544B" />
            </div>
          </div>
        ) : null}

        {data && (
          <div className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-base">自動予測の設定</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  カード請求は取引履歴から自動集計します。固定費だけ下の予定に追加してください。
                </p>
              </div>
              <a href="/settings" className="shrink-0 text-xs font-bold text-primary">設定</a>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface p-3">
                <p className="text-[11px] text-muted">毎月の固定収入</p>
                <p className="mt-1 text-sm font-bold">{(profile?.monthly_income ?? 0).toLocaleString()}円</p>
                <p className="mt-0.5 text-[11px] text-muted">毎月{profile?.income_day ?? 25}日</p>
              </div>
              <div className="rounded-xl bg-surface p-3">
                <p className="text-[11px] text-muted">カード請求見込み</p>
                <p className="mt-1 text-sm font-bold">{generatedPayments.reduce((sum, p) => sum + p.amount, 0).toLocaleString()}円</p>
                <p className="mt-0.5 text-[11px] text-muted">{creditCards.length}件のカード設定</p>
              </div>
            </div>
          </div>
        )}

        {upcomingCardBills.length > 0 && (
          <div className="card p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-base">カード引き落とし見込み</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  取り込んだカード利用通知を月末締めでまとめ、翌月の引き落とし日に反映します。
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                {upcomingCardBills.length}件
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {upcomingCardBills.map(payment => (
                <div key={payment.id} className="rounded-xl bg-surface px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{payment.name}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {payment.scheduled_date?.replaceAll('-', '/')} 引き落とし
                        <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          payment.generated ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'
                        }`}>
                          {payment.generated ? '見込み' : '確定'}
                        </span>
                      </p>
                      {payment.memo && <p className="mt-1 text-[11px] text-muted">{payment.memo}</p>}
                    </div>
                    <p className="shrink-0 font-mono text-sm font-bold text-danger">
                      -{payment.amount.toLocaleString()}円
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        {focusedProjected.some(d => d.payments.length > 0) && (
          <div className="card p-4">
            <h2 className="font-bold text-base mb-3">入出金スケジュール</h2>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {focusedProjected
                .filter(d => d.payments.length > 0)
                .map(d => (
                  <div key={d.date}
                    className={`flex items-start gap-3 p-3 rounded-xl ${d.isNegative ? 'bg-danger/5 border border-danger/20' : 'bg-surface'}`}>
                    <div className="text-center shrink-0">
                      <p className="text-xs text-muted">{d.date.slice(5).replace('-', '/')}</p>
                      {d.isNegative && <span className="text-[10px] text-danger font-medium">残高不足</span>}
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                      {d.payments.map(p => (
                        <div key={p.id} className="flex justify-between text-sm">
                          <span className="text-foreground">
                            {p.name}
                            {p.generated && p.source === 'credit_card' && (
                              <span className="ml-1.5 text-[10px] text-muted font-normal">[予測]</span>
                            )}
                            {p.memo && <span className="ml-1 text-[11px] text-muted">({p.memo})</span>}
                          </span>
                          <span className={`font-medium ${p.type === 'income' ? 'text-success' : 'text-danger'}`}>
                            {p.type === 'income' ? '+' : '-'}{p.amount.toLocaleString()}円
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Scheduled Payments */}
        {data && (
          <ScheduledPaymentList payments={payments} onMutate={() => mutate()} />
        )}
      </div>
    </div>
  )
}

function LegendTile({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 rounded-lg bg-surface px-2 py-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] font-bold text-muted">{label}</span>
    </div>
  )
}
