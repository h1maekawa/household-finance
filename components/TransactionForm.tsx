'use client'
import { useState } from 'react'
import { format } from 'date-fns'
import { CATEGORIES, PAYMENT_METHODS, TransactionInput } from '@/types/transaction'
import { useToast } from '@/components/Toast'

interface Props {
  onSuccess?: () => void
}

const empty = (): TransactionInput => ({
  date: format(new Date(), 'yyyy-MM-dd'),
  amount: 0,
  category: '',
  payment_method: '',
  memo: '',
  source: 'manual',
})

export default function TransactionForm({ onSuccess }: Props) {
  const { showToast } = useToast()
  const [form, setForm] = useState<TransactionInput>(empty())
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.category)       { showToast('カテゴリを選択してください', 'warning'); return }
    if (!form.payment_method) { showToast('支払方法を選択してください', 'warning'); return }
    if (!form.amount || form.amount <= 0) { showToast('金額を入力してください', 'warning'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      showToast('保存しました', 'success')
      setForm(empty())
      onSuccess?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存に失敗しました', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-4">
      {/* 日付 */}
      <div>
        <label className="block text-sm font-medium text-muted mb-1">日付</label>
        <input
          type="date"
          value={form.date}
          onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
          className="w-full rounded-xl border border-border px-4 py-3 text-base bg-card focus:outline-none focus:ring-2 focus:ring-primary"
          required
        />
      </div>

      {/* 金額 */}
      <div>
        <label className="block text-sm font-medium text-muted mb-1">金額（円）</label>
        <input
          type="number"
          inputMode="numeric"
          placeholder="0"
          value={form.amount || ''}
          onChange={e => setForm(f => ({ ...f, amount: parseInt(e.target.value) || 0 }))}
          className="w-full rounded-xl border border-border px-4 py-3 text-2xl font-bold bg-card focus:outline-none focus:ring-2 focus:ring-primary text-danger"
          required
          min={1}
        />
      </div>

      {/* カテゴリ */}
      <div>
        <label className="block text-sm font-medium text-muted mb-2">カテゴリ</label>
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map(c => (
            <button
              key={c.name}
              type="button"
              onClick={() => setForm(f => ({ ...f, category: c.name }))}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-sm font-medium transition-base ${
                form.category === c.name
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-foreground'
              }`}
            >
              <span className="text-xl">{c.icon}</span>
              <span className="text-[11px]">{c.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 支払方法 */}
      <div>
        <label className="block text-sm font-medium text-muted mb-2">支払方法</label>
        <div className="grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map(p => (
            <button
              key={p.name}
              type="button"
              onClick={() => setForm(f => ({ ...f, payment_method: p.name }))}
              className={`py-3 rounded-xl border text-sm font-medium transition-base ${
                form.payment_method === p.name
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-foreground'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* メモ */}
      <div>
        <label className="block text-sm font-medium text-muted mb-1">メモ（任意）</label>
        <input
          type="text"
          placeholder="例：スーパーで買い物"
          value={form.memo ?? ''}
          onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
          className="w-full rounded-xl border border-border px-4 py-3 text-base bg-card focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-lg transition-base active:opacity-80 disabled:opacity-50"
      >
        {loading ? '保存中...' : '保存する'}
      </button>
    </form>
  )
}
