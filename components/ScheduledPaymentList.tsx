'use client'
import { useEffect, useState } from 'react'
import { ScheduledPayment, ScheduledPaymentInput } from '@/types/cashflow'
import { CATEGORIES } from '@/types/transaction'
import { useToast } from '@/components/Toast'

interface Props {
  payments: ScheduledPayment[]
  onMutate: () => void
}

const emptyForm = (): ScheduledPaymentInput => ({
  name:     '',
  amount:   0,
  due_day:  1,
  category: '通信費',
  type:     'fixed',
  is_active: true,
  memo:     '',
})

export default function ScheduledPaymentList({ payments, onMutate }: Props) {
  const { showToast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<ScheduledPayment | null>(null)

  async function handleToggle(p: ScheduledPayment) {
    await fetch(`/api/scheduled-payments/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !p.is_active }),
    })
    onMutate()
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/scheduled-payments/${id}`, { method: 'DELETE' })
    if (res.ok) { showToast('削除しました'); onMutate() }
    else showToast('削除に失敗しました', 'error')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-base">引き落とし予定</h3>
          <p className="mt-0.5 text-xs text-muted">家賃やサブスクなど、取引履歴から出せない固定費だけ追加します</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowModal(true) }}
          className="text-sm text-primary font-medium"
        >
          ＋ 追加
        </button>
      </div>

      {payments.length === 0 ? (
        <div className="text-center py-8 text-muted text-sm">引き落とし予定がありません</div>
      ) : (
        <div className="card overflow-hidden">
          {payments.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 px-4 py-3 ${i < payments.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-medium ${!p.is_active ? 'text-muted line-through' : ''}`}>
                    {p.name}
                  </p>
                  <span className="text-xs text-muted">{p.scheduled_date ? p.scheduled_date : `毎月${p.due_day}日`}</span>
                </div>
                <p className="text-xs text-muted">{p.category}</p>
              </div>
              <p className={`text-sm font-bold shrink-0 ${p.is_active ? 'text-danger' : 'text-muted'}`}>
                -{p.amount.toLocaleString()}円
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleToggle(p)}
                  className={`w-10 h-6 rounded-full transition-base relative ${p.is_active ? 'bg-primary' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-base ${p.is_active ? 'left-5' : 'left-1'}`} />
                </button>
                <button onClick={() => { setEditTarget(p); setShowModal(true) }} className="text-muted text-xs">✏</button>
                <button onClick={() => handleDelete(p.id)} className="text-danger text-xs">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <PaymentModal
          initial={editTarget}
          onClose={() => setShowModal(false)}
          onSave={async body => {
            const url  = editTarget ? `/api/scheduled-payments/${editTarget.id}` : '/api/scheduled-payments'
            const method = editTarget ? 'PATCH' : 'POST'
            const res = await fetch(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
            if (res.ok) {
              showToast(editTarget ? '更新しました' : '追加しました', 'success')
              onMutate()
              setShowModal(false)
            } else {
              showToast('保存に失敗しました', 'error')
            }
          }}
        />
      )}
    </div>
  )
}

function PaymentModal({
  initial, onClose, onSave,
}: {
  initial: ScheduledPayment | null
  onClose: () => void
  onSave: (body: ScheduledPaymentInput) => void
}) {
  const [form, setForm] = useState<ScheduledPaymentInput>(
    initial
      ? { name: initial.name, amount: initial.amount, due_day: initial.due_day, category: initial.category, type: initial.type === 'credit' ? 'credit' : 'fixed', is_active: initial.is_active, memo: initial.memo }
      : emptyForm()
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleSubmit() {
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  const canSave = Boolean(form.name.trim() && form.amount > 0 && form.due_day >= 1 && form.due_day <= 31)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 px-4 py-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-modal-title"
        className="flex max-h-[calc(100svh-48px)] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 id="payment-modal-title" className="font-bold text-base">{initial ? '引き落とし編集' : '引き落とし追加'}</h2>
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
            <label className="text-xs text-muted mb-1 block">名称</label>
            <input type="text" placeholder="例：楽天カード" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">金額（円）</label>
              <input type="number" inputMode="numeric" value={form.amount || ''}
                onChange={e => setForm(f => ({ ...f, amount: parseInt(e.target.value) || 0 }))}
                className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface font-bold text-danger focus:border-primary focus:bg-card focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">引き落とし日</label>
              <input type="number" inputMode="numeric" min={1} max={31} value={form.due_day}
                onChange={e => setForm(f => ({ ...f, due_day: parseInt(e.target.value) || 1 }))}
                className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">カテゴリ</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none">
                {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">種別</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as 'fixed' | 'credit' }))}
                className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none">
                <option value="fixed">固定費</option>
                <option value="credit">クレカ請求</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">メモ（任意）</label>
            <input type="text" value={form.memo ?? ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
              className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none" />
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
            onClick={handleSubmit}
            disabled={!canSave || saving}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}
