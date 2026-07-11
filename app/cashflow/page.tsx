'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { CashflowResponse } from '@/types/cashflow'
import CashflowChart from '@/components/CashflowChart'
import ScheduledPaymentList from '@/components/ScheduledPaymentList'
import { useToast } from '@/components/Toast'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function CashflowPage() {
  const { showToast } = useToast()
  const { data, mutate } = useSWR<CashflowResponse>('/api/cashflow', fetcher)
  const [editingBalance, setEditingBalance] = useState(false)
  const [newBalance, setNewBalance] = useState('')
  const [saving, setSaving] = useState(false)

  const current = data?.currentBalance
  const projected = data?.projectedDays ?? []
  const payments  = data?.scheduledPayments ?? []
  const generatedPayments = data?.generatedPayments ?? []
  const creditCards = data?.creditCards ?? []
  const profile = data?.profile

  const minBalance = projected.length > 0 ? Math.min(...projected.map(d => d.balance)) : 0
  const negDays    = projected.filter(d => d.isNegative).length

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
        <h1 className="text-xl font-bold mb-4">キャッシュフロー予測</h1>

        {/* Balance */}
        <div className="bg-white/10 rounded-2xl p-4">
          <p className="text-white/70 text-xs mb-1">現在の口座残高</p>
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
        {/* Alerts */}
        {negDays > 0 && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-danger/10 text-danger border border-danger/20 text-sm font-medium">
            <span className="text-base mt-0.5">⚠</span>
            <p>今後30日間で残高がマイナスになる日が <strong>{negDays}日</strong> あります（最小: {minBalance.toLocaleString()}円）</p>
          </div>
        )}

        {/* Chart */}
        {!data ? (
          <div className="card p-4">
            <div className="skeleton h-5 w-32 rounded mb-3" />
            <div className="skeleton h-48 w-full rounded-xl" />
          </div>
        ) : projected.length > 0 ? (
          <div className="card p-4">
            <h2 className="font-bold text-base mb-3">30日間の残高推移</h2>
            <CashflowChart data={projected} />
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

        {/* Timeline */}
        {projected.some(d => d.payments.length > 0) && (
          <div className="card p-4">
            <h2 className="font-bold text-base mb-3">入出金スケジュール</h2>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {projected
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
