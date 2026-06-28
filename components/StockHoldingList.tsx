'use client'
import { useState } from 'react'
import { StockWithQuote, StockHoldingInput } from '@/types/stock'
import { useToast } from '@/components/Toast'

interface Props {
  holdings: StockWithQuote[]
  onMutate: () => void
}

const emptyForm = (): StockHoldingInput => ({
  ticker:       '',
  name:         '',
  market:       'JP',
  shares:       0,
  average_cost: 0,
})

export default function StockHoldingList({ holdings, onMutate }: Props) {
  const { showToast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<StockWithQuote | null>(null)

  async function handleDelete(id: string) {
    const res = await fetch(`/api/stocks/${id}`, { method: 'DELETE' })
    if (res.ok) { showToast('削除しました'); onMutate() }
    else showToast('削除に失敗しました', 'error')
  }

  if (holdings.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 text-muted gap-2">
        <span className="text-4xl">📈</span>
        <p className="text-sm">保有銘柄がありません</p>
        <button onClick={() => { setEditTarget(null); setShowModal(true) }}
          className="mt-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium">
          ＋ 銘柄を追加
        </button>
        {showModal && <StockModal initial={null} onClose={() => setShowModal(false)} onSave={body => save(null, body, showToast, onMutate, setShowModal)} />}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-base">保有銘柄</h3>
        <button onClick={() => { setEditTarget(null); setShowModal(true) }}
          className="text-sm text-primary font-medium">
          ＋ 追加
        </button>
      </div>

      <div className="card overflow-hidden">
        {holdings.map((h, i) => {
          const gainColor = !h.gainLoss ? '' : h.gainLoss >= 0 ? 'text-success' : 'text-danger'
          return (
            <div key={h.id} className={`px-4 py-3 ${i < holdings.length - 1 ? 'border-b border-border' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-surface text-muted font-mono">{h.ticker}</span>
                    <span className="text-xs text-muted">{h.market === 'JP' ? '東証' : '米国'}</span>
                  </div>
                  <p className="text-sm font-medium mt-0.5 truncate">{h.name}</p>
                  <p className="text-xs text-muted">{h.shares}株 · 取得単価 {h.average_cost.toLocaleString()}円</p>
                </div>
                <div className="text-right shrink-0">
                  {h.error ? (
                    <p className="text-xs text-muted">取得失敗</p>
                  ) : (
                    <>
                      <p className="text-sm font-bold">{h.currentValue?.toLocaleString() ?? '-'}円</p>
                      <p className={`text-xs font-medium ${gainColor}`}>
                        {h.gainLoss !== null && h.gainLoss !== undefined
                          ? `${h.gainLoss >= 0 ? '+' : ''}${h.gainLoss.toLocaleString()}円 (${h.gainLossRate !== null ? (h.gainLossRate * 100).toFixed(1) : 0}%)`
                          : '-'}
                      </p>
                    </>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-1">
                <button onClick={() => { setEditTarget(h); setShowModal(true) }} className="text-xs text-muted">✏ 編集</button>
                <button onClick={() => handleDelete(h.id)} className="text-xs text-danger">✕ 削除</button>
              </div>
            </div>
          )
        })}
      </div>

      {showModal && (
        <StockModal
          initial={editTarget}
          onClose={() => setShowModal(false)}
          onSave={body => save(editTarget, body, showToast, onMutate, setShowModal)}
        />
      )}
    </div>
  )
}

async function save(
  target: StockWithQuote | null,
  body: StockHoldingInput,
  showToast: (m: string, t?: 'success' | 'error') => void,
  onMutate: () => void,
  setShowModal: (v: boolean) => void
) {
  const url    = target ? `/api/stocks/${target.id}` : '/api/stocks'
  const method = target ? 'PATCH' : 'POST'
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) {
    showToast(target ? '更新しました' : '追加しました', 'success')
    onMutate()
    setShowModal(false)
  } else {
    showToast('保存に失敗しました', 'error')
  }
}

function StockModal({
  initial, onClose, onSave,
}: {
  initial: StockWithQuote | null
  onClose: () => void
  onSave: (body: StockHoldingInput) => void
}) {
  const [form, setForm] = useState<StockHoldingInput>(
    initial
      ? { ticker: initial.ticker, name: initial.name, market: initial.market, shares: initial.shares, average_cost: initial.average_cost }
      : emptyForm()
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="w-full bg-card rounded-t-2xl p-4 flex flex-col gap-4 max-h-[80svh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg">{initial ? '銘柄を編集' : '銘柄を追加'}</h2>
          <button onClick={onClose} className="text-muted text-xl">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted mb-1 block">ティッカー</label>
            <input type="text" placeholder="例：7203" value={form.ticker}
              onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
              className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-surface font-mono" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">市場</label>
            <select value={form.market} onChange={e => setForm(f => ({ ...f, market: e.target.value as 'JP' | 'US' }))}
              className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-surface">
              <option value="JP">東証（JP）</option>
              <option value="US">米国（US）</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">銘柄名</label>
          <input type="text" placeholder="例：トヨタ自動車" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-surface" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted mb-1 block">保有株数</label>
            <input type="number" inputMode="numeric" value={form.shares || ''}
              onChange={e => setForm(f => ({ ...f, shares: parseInt(e.target.value) || 0 }))}
              className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-surface" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">平均取得単価（円）</label>
            <input type="number" inputMode="numeric" value={form.average_cost || ''}
              onChange={e => setForm(f => ({ ...f, average_cost: parseInt(e.target.value) || 0 }))}
              className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-surface" />
          </div>
        </div>

        <button onClick={() => onSave(form)}
          className="w-full py-3 rounded-2xl bg-primary text-white font-bold transition-base active:opacity-80">
          保存する
        </button>
      </div>
    </div>
  )
}
