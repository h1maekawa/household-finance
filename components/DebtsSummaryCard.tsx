'use client'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { format } from 'date-fns'
import { Debt, DebtDirection, DebtInput } from '@/types/debt'
import { ScheduledPayment } from '@/types/cashflow'
import { getUnpaidScheduledPayments } from '@/lib/unpaid'
import { useToast } from '@/components/Toast'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function DebtsSummaryCard() {
  const { showToast } = useToast()
  const { data: debts, mutate: mutateDebts } = useSWR<Debt[]>('/api/debts', fetcher)
  const { data: payments, mutate: mutatePayments } = useSWR<ScheduledPayment[]>('/api/scheduled-payments', fetcher)
  const [addModal, setAddModal] = useState<DebtDirection | null>(null)

  const borrowed = (debts ?? []).filter(d => d.direction === 'borrowed')
  const lent = (debts ?? []).filter(d => d.direction === 'lent')
  const unpaid = getUnpaidScheduledPayments(payments ?? [])

  const borrowedTotal = borrowed.reduce((s, d) => s + d.amount, 0)
  const lentTotal = lent.reduce((s, d) => s + d.amount, 0)
  const unpaidTotal = unpaid.reduce((s, p) => s + p.amount, 0)

  async function settleDebt(id: string) {
    const res = await fetch(`/api/debts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_settled: true }),
    })
    if (res.ok) { showToast('完了にしました', 'success'); mutateDebts() }
    else showToast('更新に失敗しました', 'error')
  }

  async function markPaid(id: string) {
    const thisMonth = format(new Date(), 'yyyy-MM')
    const res = await fetch(`/api/scheduled-payments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_paid_month: thisMonth }),
    })
    if (res.ok) { showToast('支払い済みにしました', 'success'); mutatePayments() }
    else showToast('更新に失敗しました', 'error')
  }

  if (borrowed.length === 0 && lent.length === 0 && unpaid.length === 0 && debts && payments) {
    // 何も無ければカードを縮小表示(追加ボタンだけ出す)
    return (
      <div className="card flex items-center justify-between p-4">
        <p className="text-sm text-muted">貸し借り・未納はありません</p>
        <div className="flex gap-2">
          <button onClick={() => setAddModal('borrowed')} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted">
            ＋ 借りた
          </button>
          <button onClick={() => setAddModal('lent')} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted">
            ＋ 貸した
          </button>
        </div>
        {addModal && (
          <AddDebtModal
            direction={addModal}
            onClose={() => setAddModal(null)}
            onSaved={() => { setAddModal(null); mutateDebts() }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="card flex flex-col gap-4 p-4">
      <Section
        title="借りている金"
        tone="danger"
        total={borrowedTotal}
        onAdd={() => setAddModal('borrowed')}
      >
        {borrowed.map(d => (
          <DebtRow key={d.id} debt={d} actionLabel="返済した" onAction={() => settleDebt(d.id)} />
        ))}
      </Section>

      <Section
        title="貸している金"
        tone="success"
        total={lentTotal}
        onAdd={() => setAddModal('lent')}
      >
        {lent.map(d => (
          <DebtRow key={d.id} debt={d} actionLabel="返してもらった" onAction={() => settleDebt(d.id)} />
        ))}
      </Section>

      {unpaid.length > 0 && (
        <Section title="未納分" tone="warning" total={unpaidTotal}>
          {unpaid.map(p => (
            <div key={p.id} className="flex items-center justify-between border-t border-border py-2 first:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{p.name}</p>
                <p className="text-[11px] text-muted">毎月{p.due_day}日</p>
              </div>
              <p className="mr-3 shrink-0 font-mono text-sm text-warning">{p.amount.toLocaleString()}円</p>
              <button
                onClick={() => markPaid(p.id)}
                className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted"
              >
                支払った
              </button>
            </div>
          ))}
        </Section>
      )}

      {addModal && (
        <AddDebtModal
          direction={addModal}
          onClose={() => setAddModal(null)}
          onSaved={() => { setAddModal(null); mutateDebts() }}
        />
      )}
    </div>
  )
}

function Section({
  title, tone, total, onAdd, children,
}: {
  title: string
  tone: 'danger' | 'success' | 'warning'
  total: number
  onAdd?: () => void
  children: React.ReactNode
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-warning'
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold">{title}</h3>
        <div className="flex items-center gap-2">
          <p className={`font-mono text-sm font-bold ${toneClass}`}>{total.toLocaleString()}円</p>
          {onAdd && (
            <button onClick={onAdd} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted">
              ＋追加
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function DebtRow({ debt, actionLabel, onAction }: { debt: Debt; actionLabel: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between border-t border-border py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">{debt.counterparty}</p>
        <p className="text-[11px] text-muted">
          {debt.date}{debt.memo ? ` ・ ${debt.memo}` : ''}
        </p>
      </div>
      <p className="mr-3 shrink-0 font-mono text-sm">{debt.amount.toLocaleString()}円</p>
      <button onClick={onAction} className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted">
        {actionLabel}
      </button>
    </div>
  )
}

function AddDebtModal({
  direction, onClose, onSaved,
}: {
  direction: DebtDirection
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [form, setForm] = useState<DebtInput>({
    direction,
    counterparty: '',
    amount: 0,
    date: format(new Date(), 'yyyy-MM-dd'),
    memo: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleSave() {
    if (!form.counterparty.trim()) { showToast('相手の名前を入力してください', 'warning'); return }
    if (!form.amount || form.amount <= 0) { showToast('金額を入力してください', 'warning'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/debts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      showToast('保存しました', 'success')
      onSaved()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存に失敗しました', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 px-4 py-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="debt-modal-title"
        className="flex max-h-[calc(100svh-48px)] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 id="debt-modal-title" className="font-bold text-base">
            {direction === 'borrowed' ? '借りたお金を記録' : '貸したお金を記録'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted transition-base active:bg-surface"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <div>
            <label className="text-xs text-muted mb-1 block">相手</label>
            <input
              type="text"
              value={form.counterparty}
              onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))}
              placeholder="例：田中さん"
              className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">金額</label>
              <input
                type="number"
                inputMode="numeric"
                value={form.amount || ''}
                onChange={e => setForm(f => ({ ...f, amount: parseInt(e.target.value) || 0 }))}
                className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface font-bold focus:border-primary focus:bg-card focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">日付</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">メモ(任意)</label>
            <input
              type="text"
              value={form.memo ?? ''}
              onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
              placeholder="例：飲み会の立て替え"
              className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-surface py-3 text-sm font-bold text-foreground transition-base active:opacity-80 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}
