'use client'
import { ChangeEvent, useEffect, useState } from 'react'
import { StockWithQuote, StockHoldingInput } from '@/types/stock'
import { readRakutenStockCsv, readRakutenStockTransactions } from '@/lib/rakuten-stock-csv'
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
  const [importing, setImporting] = useState(false)

  async function handleDelete(id: string) {
    const res = await fetch(`/api/stocks/${id}`, { method: 'DELETE' })
    if (res.ok) { showToast('削除しました'); onMutate() }
    else showToast('削除に失敗しました', 'error')
  }

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setImporting(true)
    try {
      const imported = await readRakutenStockCsv(file)
      if (imported.length === 0) {
        const transactions = await readRakutenStockTransactions(file)
        if (transactions.length === 0) {
          showToast('CSVから銘柄を読み取れませんでした', 'warning')
          return
        }
      }

      let added = 0
      let updated = 0
      let cleaned = 0
      const isBalanceSnapshot = imported.some(item => item.broker_current_value && item.broker_current_value > 0)
      const invalidHoldings = holdings.filter(h => h.shares <= 0 && !(h.broker_current_value && h.broker_current_value > 0))
      for (const holding of invalidHoldings) {
        const res = await fetch(`/api/stocks/${holding.id}`, { method: 'DELETE' })
        if (res.ok) cleaned += 1
      }
      let activeHoldings = holdings.filter(h => !invalidHoldings.some(invalid => invalid.id === h.id))
      if (isBalanceSnapshot) {
        const importedKeys = new Set(imported.map(item => `${item.market}:${item.ticker.toUpperCase()}`))
        const importedMarkets = new Set(imported.map(item => item.market))
        const staleHoldings = activeHoldings.filter(h =>
          importedMarkets.has(h.market) && !importedKeys.has(`${h.market}:${h.ticker.toUpperCase()}`)
        )
        for (const holding of staleHoldings) {
          const res = await fetch(`/api/stocks/${holding.id}`, { method: 'DELETE' })
          if (res.ok) cleaned += 1
        }
        activeHoldings = activeHoldings.filter(h => !staleHoldings.some(stale => stale.id === h.id))
      }

      for (const item of imported) {
        const existing = activeHoldings.find(h =>
          h.ticker.toUpperCase() === item.ticker.toUpperCase() && h.market === item.market
        )
        const res = await fetch(existing ? `/api/stocks/${existing.id}` : '/api/stocks', {
          method: existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        })

        if (!res.ok) throw new Error((await res.json()).error ?? 'CSV取込に失敗しました')
        if (existing) updated += 1
        else added += 1
      }

      const transactions = await readRakutenStockTransactions(file)
      if (transactions.length > 0) {
        const res = await fetch('/api/investment-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactions }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? '取引履歴の保存に失敗しました')
      }

      showToast(`楽天CSVを反映しました: 新規${added}件 / 更新${updated}件${cleaned ? ` / 整理${cleaned}件` : ''}`, 'success')
      onMutate()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CSV取込に失敗しました', 'error')
    } finally {
      setImporting(false)
      event.target.value = ''
    }
  }

  const ImportButton = (
    <label className={`rounded-xl border border-border px-3 py-2 text-sm font-medium text-primary active:opacity-80 ${importing ? 'opacity-50' : ''}`}>
      {importing ? '取込中...' : '楽天CSV取込'}
      <input type="file" accept=".csv,text/csv" onChange={handleCsvUpload} disabled={importing} className="hidden" />
    </label>
  )

  if (holdings.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 text-muted gap-2">
        <span className="text-4xl">📈</span>
        <p className="text-sm">保有銘柄がありません</p>
        <div className="mt-2 flex gap-2">
          {ImportButton}
          <button onClick={() => { setEditTarget(null); setShowModal(true) }}
            className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium">
            ＋ 銘柄を追加
          </button>
        </div>
        {showModal && <StockModal initial={null} onClose={() => setShowModal(false)} onSave={body => save(null, body, showToast, onMutate, setShowModal)} />}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-base">保有銘柄</h3>
        <div className="flex items-center gap-2">
          {ImportButton}
          <button onClick={() => { setEditTarget(null); setShowModal(true) }}
            className="text-sm text-primary font-medium">
            ＋ 追加
          </button>
        </div>
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
                    {h.valueSource === 'broker' && (
                      <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-bold text-success">楽天評価</span>
                    )}
                  </div>
                  <p className="text-sm font-medium mt-0.5 truncate">{h.name}</p>
                  <p className="text-xs text-muted">{h.shares}株 · 取得単価 {h.average_cost.toLocaleString()}円</p>
                  {h.valueSource === 'broker' && h.broker_current_price && (
                    <p className="text-[11px] text-muted">
                      楽天現在値 {h.broker_current_price.toLocaleString()}{h.broker_price_currency === 'USD' ? 'USドル' : '円'}
                      {h.broker_fx_rate ? ` · 為替 ${h.broker_fx_rate.toFixed(2)}円` : ''}
                    </p>
                  )}
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
                      {h.valueSource === 'broker' && h.yahooCurrentValue !== null && h.yahooCurrentValue !== undefined && (
                        <p className="mt-0.5 text-[10px] text-muted">
                          Yahoo参考 {h.yahooCurrentValue.toLocaleString()}円
                        </p>
                      )}
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
): Promise<boolean> {
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
    return true
  } else {
    showToast('保存に失敗しました', 'error')
    return false
  }
}

function StockModal({
  initial, onClose, onSave,
}: {
  initial: StockWithQuote | null
  onClose: () => void
  onSave: (body: StockHoldingInput) => Promise<boolean>
}) {
  const [form, setForm] = useState<StockHoldingInput>(
    initial
      ? { ticker: initial.ticker, name: initial.name, market: initial.market, shares: initial.shares, average_cost: initial.average_cost }
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
    if (!form.ticker || !form.name || form.shares <= 0 || form.average_cost <= 0) return
    setSaving(true)
    const saved = await onSave(form)
    if (!saved) setSaving(false)
  }

  const canSave = Boolean(form.ticker && form.name && form.shares > 0 && form.average_cost > 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 px-4 py-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-modal-title"
        className="flex max-h-[calc(100svh-48px)] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 id="stock-modal-title" className="font-bold text-base">{initial ? '銘柄を編集' : '銘柄を追加'}</h2>
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
            <label className="text-xs text-muted mb-1 block">ティッカー</label>
            <input type="text" placeholder="例：7203" value={form.ticker}
              onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
              className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface font-mono focus:border-primary focus:bg-card focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">市場</label>
            <select value={form.market} onChange={e => setForm(f => ({ ...f, market: e.target.value as 'JP' | 'US' }))}
              className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none">
              <option value="JP">東証（JP）</option>
              <option value="US">米国（US）</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">銘柄名</label>
            <input type="text" placeholder="例：トヨタ自動車" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none" />
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">保有株数</label>
            <input type="number" inputMode="numeric" value={form.shares || ''}
              onChange={e => setForm(f => ({ ...f, shares: Number(e.target.value) || 0 }))}
              className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-surface focus:border-primary focus:bg-card focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">平均取得単価（円）</label>
            <input type="number" inputMode="numeric" value={form.average_cost || ''}
              onChange={e => setForm(f => ({ ...f, average_cost: Number(e.target.value) || 0 }))}
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
