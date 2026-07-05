'use client'
import { useState, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Transaction, TransactionInput, CATEGORIES, PAYMENT_METHODS } from '@/types/transaction'
import { useToast } from '@/components/Toast'

interface Props {
  transactions: Transaction[]
  onMutate: () => void
}

const CATEGORY_TONE: Record<string, { bg: string; text: string }> = {
  '食費':      { bg: 'bg-[#FBEAE9]', text: 'text-[#E2544B]' },
  '外食':      { bg: 'bg-[#FBEAE9]', text: 'text-[#E2544B]' },
  '交通費':    { bg: 'bg-[#F0F3F7]', text: 'text-[#8891A0]' },
  '日用品':    { bg: 'bg-[#E3F5F0]', text: 'text-[#1FAE8C]' },
  '娯楽':      { bg: 'bg-[#E3F5F0]', text: 'text-[#1FAE8C]' },
  '医療':      { bg: 'bg-[#F0F3F7]', text: 'text-[#8891A0]' },
  '通信費':    { bg: 'bg-[#E8F2FA]', text: 'text-[#1476B3]' },
  '水道光熱費': { bg: 'bg-[#E8F2FA]', text: 'text-[#1476B3]' },
}
const DEFAULT_TONE = { bg: 'bg-[#F0F3F7]', text: 'text-[#8891A0]' }

function groupByDate(txs: Transaction[]): [string, Transaction[]][] {
  const map = new Map<string, Transaction[]>()
  for (const t of txs) {
    const existing = map.get(t.date) ?? []
    existing.push(t)
    map.set(t.date, existing)
  }
  return Array.from(map.entries())
}

export default function TransactionList({ transactions, onMutate }: Props) {
  const { showToast } = useToast()
  const [editTarget, setEditTarget] = useState<Transaction | null>(null)

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted gap-3">
        <span className="text-5xl">📋</span>
        <p className="text-sm">まだデータがありません</p>
      </div>
    )
  }

  const grouped = groupByDate(transactions)

  return (
    <>
      <div className="flex flex-col gap-4">
        {grouped.map(([date, txs]) => (
          <div key={date}>
            <p className="mb-1.5 px-1 font-mono text-[11px] text-muted">
              {format(parseISO(date), 'M月d日（E）', { locale: ja })}
            </p>
            <div className="card overflow-hidden">
              {txs.map((tx, i) => (
                <SwipeableRow
                  key={tx.id}
                  tx={tx}
                  isLast={i === txs.length - 1}
                  onDelete={async () => {
                    const res = await fetch(`/api/transactions/${tx.id}`, { method: 'DELETE' })
                    if (res.ok) { showToast('削除しました'); onMutate() }
                    else showToast('削除に失敗しました', 'error')
                  }}
                  onEdit={() => setEditTarget(tx)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {editTarget && (
        <EditModal
          tx={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={async body => {
            const res = await fetch(`/api/transactions/${editTarget.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
            if (res.ok) { showToast('更新しました', 'success'); onMutate(); setEditTarget(null) }
            else showToast('更新に失敗しました', 'error')
          }}
        />
      )}
    </>
  )
}

function SwipeableRow({
  tx, isLast, onDelete, onEdit,
}: {
  tx: Transaction
  isLast: boolean
  onDelete: () => void
  onEdit: () => void
}) {
  const [offsetX, setOffsetX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startX  = useRef(0)

  const catIcon = CATEGORIES.find(c => c.name === tx.category)?.icon ?? '📦'
  const tone = CATEGORY_TONE[tx.category] ?? DEFAULT_TONE

  return (
    <div className={`relative overflow-hidden ${!isLast ? 'border-b border-border' : ''}`}>
      {/* Delete button behind */}
      <div className="absolute right-0 top-0 bottom-0 w-20 flex items-center justify-center bg-danger">
        <button onClick={onDelete} className="text-white text-sm font-bold">削除</button>
      </div>

      {/* Row */}
      <div
        style={{ transform: `translateX(-${offsetX}px)`, transition: isDragging ? 'none' : 'transform 0.2s ease' }}
        className="relative bg-card flex items-center gap-3 px-4 py-3"
        onTouchStart={e => {
          startX.current = e.touches[0].clientX
          setIsDragging(true)
        }}
        onTouchMove={e => {
          const diff = startX.current - e.touches[0].clientX
          if (diff > 0) setOffsetX(Math.min(diff, 80))
          else if (offsetX > 0) setOffsetX(Math.max(0, 80 + diff))
        }}
        onTouchEnd={() => {
          setIsDragging(false)
          setOffsetX(prev => prev > 40 ? 80 : 0)
        }}
        onClick={() => { if (offsetX === 0) onEdit() }}
      >
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-base ${tone.bg} ${tone.text}`}>
          {catIcon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-[13px]">
            {tx.memo || tx.category}
            <span className="ml-2 rounded bg-surface px-2 py-0.5 text-[10px] text-muted">{tx.payment_method}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted">{tx.category}</p>
        </div>
        <p className="shrink-0 font-mono text-sm text-danger">
          -{tx.amount.toLocaleString()}円
        </p>
      </div>
    </div>
  )
}

function EditModal({
  tx, onClose, onSave,
}: {
  tx: Transaction
  onClose: () => void
  onSave: (body: Partial<TransactionInput>) => void
}) {
  const [form, setForm] = useState<Partial<TransactionInput>>({
    date:           tx.date,
    amount:         tx.amount,
    category:       tx.category,
    payment_method: tx.payment_method,
    memo:           tx.memo,
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-card rounded-t-2xl p-4 flex flex-col gap-4 max-h-[85svh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg">取引を編集</h2>
          <button onClick={onClose} className="text-muted text-xl">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted mb-1 block">日付</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-surface" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">金額</label>
            <input type="number" inputMode="numeric" value={form.amount || ''}
              onChange={e => setForm(f => ({ ...f, amount: parseInt(e.target.value) || 0 }))}
              className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-surface font-bold text-danger" />
          </div>
        </div>

        <div>
          <label className="text-xs text-muted mb-2 block">カテゴリ</label>
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map(c => (
              <button key={c.name} type="button" onClick={() => setForm(f => ({ ...f, category: c.name }))}
                className={`flex flex-col items-center py-2 rounded-xl border text-xs font-medium transition-base ${
                  form.category === c.name ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card'
                }`}>
                <span className="text-lg">{c.icon}</span>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-muted mb-2 block">支払方法</label>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map(p => (
              <button key={p.name} type="button" onClick={() => setForm(f => ({ ...f, payment_method: p.name }))}
                className={`py-2 rounded-xl border text-sm font-medium transition-base ${
                  form.payment_method === p.name ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card'
                }`}>
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">メモ</label>
          <input type="text" value={form.memo ?? ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-surface" />
        </div>

        <button onClick={() => onSave(form)}
          className="w-full py-3 rounded-2xl bg-primary text-white font-bold transition-base active:opacity-80">
          保存する
        </button>
      </div>
    </div>
  )
}
