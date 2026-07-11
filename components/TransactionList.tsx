'use client'
import { useEffect, useState, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Transaction, TransactionInput, CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from '@/types/transaction'
import { DebtDirection } from '@/types/debt'
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
  '給与':      { bg: 'bg-[#E3F5F0]', text: 'text-[#1FAE8C]' },
  'その他収入': { bg: 'bg-[#E3F5F0]', text: 'text-[#1FAE8C]' },
}
const DEFAULT_TONE = { bg: 'bg-[#F0F3F7]', text: 'text-[#8891A0]' }

function categoryIcon(category: string): string {
  return (
    CATEGORIES.find(c => c.name === category)?.icon ??
    INCOME_CATEGORIES.find(c => c.name === category)?.icon ??
    '📦'
  )
}

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
  const reviewTransactions = transactions.filter(tx => tx.needs_review)

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
        {reviewTransactions.length > 0 && (
          <div className="card overflow-hidden border border-warning/30">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-bold">確認が必要な取引</p>
                <p className="mt-0.5 text-xs text-muted">金額を見てカテゴリやメモを入力してください</p>
              </div>
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-bold text-warning">
                {reviewTransactions.length}件
              </span>
            </div>
            {reviewTransactions.slice(0, 5).map(tx => (
              <button
                key={tx.id}
                type="button"
                onClick={() => setEditTarget(tx)}
                className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 active:bg-surface"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-warning/10 text-warning">!</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{tx.memo || tx.review_reason || '内容を確認してください'}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{tx.date} · {tx.payment_method}</p>
                </div>
                <p className="shrink-0 font-mono text-sm text-danger">-{tx.amount.toLocaleString()}円</p>
              </button>
            ))}
          </div>
        )}

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
          onCreateDebt={async ({ direction, counterparty, amount }) => {
            const res = await fetch('/api/debts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                direction,
                counterparty,
                amount,
                date: editTarget.date,
                memo: editTarget.memo || `${editTarget.payment_method} ${editTarget.category}`,
              }),
            })
            if (res.ok) {
              showToast(direction === 'lent' ? '貸したお金に追加しました' : '借りたお金に追加しました', 'success')
              onMutate()
            } else {
              showToast('貸し借りへの追加に失敗しました', 'error')
            }
          }}
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

  const catIcon = categoryIcon(tx.category)
  const tone = CATEGORY_TONE[tx.category] ?? DEFAULT_TONE
  const isIncome = tx.kind === 'income'

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
        <p className={`shrink-0 font-mono text-sm ${isIncome ? 'text-success' : 'text-danger'}`}>
          {isIncome ? '+' : '-'}{tx.amount.toLocaleString()}円
        </p>
      </div>
    </div>
  )
}

function EditModal({
  tx, onClose, onSave,
  onCreateDebt,
}: {
  tx: Transaction
  onClose: () => void
  onSave: (body: Partial<TransactionInput>) => void
  onCreateDebt: (body: { direction: DebtDirection; counterparty: string; amount: number }) => Promise<void>
}) {
  const [form, setForm] = useState<Partial<TransactionInput>>({
    date:           tx.date,
    amount:         tx.amount,
    category:       tx.category,
    payment_method: tx.payment_method,
    memo:           tx.memo,
    kind:           tx.kind ?? 'expense',
  })
  const [debtCounterparty, setDebtCounterparty] = useState('')
  const [debtAmount, setDebtAmount] = useState(tx.amount)
  const [creatingDebt, setCreatingDebt] = useState(false)

  const isIncome = form.kind === 'income'
  const categoryOptions = isIncome ? INCOME_CATEGORIES : CATEGORIES

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleCreateDebt(direction: DebtDirection) {
    if (!debtCounterparty.trim()) return
    if (!debtAmount || debtAmount <= 0) return

    setCreatingDebt(true)
    try {
      await onCreateDebt({ direction, counterparty: debtCounterparty.trim(), amount: debtAmount })
      setDebtCounterparty('')
      setDebtAmount(tx.amount)
    } finally {
      setCreatingDebt(false)
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
        aria-labelledby="transaction-modal-title"
        className="flex max-h-[calc(100svh-48px)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 id="transaction-modal-title" className="font-bold text-base">取引を編集</h2>
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
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface p-1">
            {(['expense', 'income'] as const).map(k => (
              <button key={k} type="button"
                onClick={() => setForm(f => ({ ...f, kind: k, category: undefined }))}
                className={`py-2 rounded-lg text-sm font-medium transition-base ${
                  form.kind === k ? 'bg-card shadow-sm text-foreground' : 'text-muted'
                }`}>
                {k === 'expense' ? '支出' : '収入'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">日付</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">金額</label>
              <input type="number" inputMode="numeric" value={form.amount || ''}
                onChange={e => setForm(f => ({ ...f, amount: parseInt(e.target.value) || 0 }))}
                className={`w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface font-bold focus:border-primary focus:bg-card focus:outline-none ${isIncome ? 'text-success' : 'text-danger'}`} />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted mb-2 block">カテゴリ</label>
            <div className="grid grid-cols-3 gap-2">
              {categoryOptions.map(c => (
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
              className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none" />
          </div>

          <div className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold">この取引を貸し借りにも記録</p>
              <p className="mt-0.5 text-xs text-muted">相手と金額を入れて、立替や借りた分として残せます</p>
            </div>
            <p className="shrink-0 font-mono text-xs text-muted">{tx.amount.toLocaleString()}円</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">相手</label>
                <input
                  type="text"
                  value={debtCounterparty}
                  onChange={e => setDebtCounterparty(e.target.value)}
                  placeholder="例：田中さん"
                  className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-card"
                />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">金額</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={debtAmount || ''}
                  onChange={e => setDebtAmount(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-card font-bold"
                />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleCreateDebt('lent')}
              disabled={creatingDebt || !debtCounterparty.trim() || debtAmount <= 0}
              className="rounded-xl border border-success/30 bg-card py-2 text-sm font-bold text-success disabled:opacity-50"
            >
              貸した
            </button>
            <button
              type="button"
              onClick={() => handleCreateDebt('borrowed')}
              disabled={creatingDebt || !debtCounterparty.trim() || debtAmount <= 0}
              className="rounded-xl border border-danger/30 bg-card py-2 text-sm font-bold text-danger disabled:opacity-50"
            >
              借りた
            </button>
          </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-surface py-3 text-sm font-bold text-foreground transition-base active:opacity-80"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onSave(form)}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80"
          >
            {tx.needs_review ? '確認して保存' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}
