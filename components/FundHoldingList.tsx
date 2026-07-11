'use client'
import { ChangeEvent, useState } from 'react'
import { FundHolding } from '@/types/fund'
import { readRakutenFundCsv, readRakutenFundTransactions } from '@/lib/rakuten-fund-csv'
import { useToast } from '@/components/Toast'

interface Props {
  funds: FundHolding[]
  onMutate: () => void
}

export default function FundHoldingList({ funds, onMutate }: Props) {
  const { showToast } = useToast()
  const [importing, setImporting] = useState(false)

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setImporting(true)
    try {
      const imported = await readRakutenFundCsv(file)
      if (imported.length === 0) {
        const transactions = await readRakutenFundTransactions(file)
        if (transactions.length === 0) {
          showToast('CSVから投資信託を読み取れませんでした', 'warning')
          return
        }
      }

      let added = 0
      let updated = 0
      let cleaned = 0
      let activeFunds = funds
      const isBalanceSnapshot = imported.some(item => item.gain_loss !== 0 || item.gain_loss_rate !== 0)
      if (isBalanceSnapshot) {
        const importedKeys = new Set(imported.map(item => `${item.name}:${item.account_type ?? ''}`))
        const staleFunds = funds.filter(fund => !importedKeys.has(`${fund.name}:${fund.account_type ?? ''}`))
        for (const fund of staleFunds) {
          const res = await fetch(`/api/funds/${fund.id}`, { method: 'DELETE' })
          if (res.ok) cleaned += 1
        }
        activeFunds = funds.filter(fund => !staleFunds.some(stale => stale.id === fund.id))
      }

      for (const item of imported) {
        const existing = activeFunds.find(fund =>
          fund.name === item.name && (fund.account_type ?? '') === (item.account_type ?? '')
        )
        const res = await fetch(existing ? `/api/funds/${existing.id}` : '/api/funds', {
          method: existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        })

        if (!res.ok) throw new Error((await res.json()).error ?? '投信CSV取込に失敗しました')
        if (existing) updated += 1
        else added += 1
      }

      const transactions = await readRakutenFundTransactions(file)
      if (transactions.length > 0) {
        const res = await fetch('/api/investment-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactions }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? '取引履歴の保存に失敗しました')
      }

      showToast(`投信CSVを反映しました: 新規${added}件 / 更新${updated}件${cleaned ? ` / 整理${cleaned}件` : ''}`, 'success')
      onMutate()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '投信CSV取込に失敗しました', 'error')
    } finally {
      setImporting(false)
      event.target.value = ''
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/funds/${id}`, { method: 'DELETE' })
    if (res.ok) {
      showToast('削除しました', 'success')
      onMutate()
    } else {
      showToast('削除に失敗しました', 'error')
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-bold text-base">投資信託</h3>
        <label className={`rounded-xl border border-border px-3 py-2 text-sm font-medium text-primary active:opacity-80 ${importing ? 'opacity-50' : ''}`}>
          {importing ? '取込中...' : '投信CSV取込'}
          <input type="file" accept=".csv,text/csv" onChange={handleCsvUpload} disabled={importing} className="hidden" />
        </label>
      </div>

      {funds.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-8 text-muted">
          <span className="text-3xl">積</span>
          <p className="text-sm">投資信託がありません</p>
          <p className="text-xs">楽天証券の投信CSVを取り込むと表示されます</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {funds.map((fund, index) => {
            const gainColor = fund.gain_loss >= 0 ? 'text-success' : 'text-danger'
            return (
              <div key={fund.id} className={`px-4 py-3 ${index < funds.length - 1 ? 'border-b border-border' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-bold text-success">投信</span>
                      {fund.account_type && <span className="text-xs text-muted">{fund.account_type}</span>}
                    </div>
                    <p className="truncate text-sm font-medium">{fund.name}</p>
                    <p className="text-xs text-muted">
                      {fund.units.toLocaleString()}口 · 基準価額 {fund.base_price.toLocaleString()}円
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold">{fund.current_value.toLocaleString()}円</p>
                    <p className={`text-xs font-medium ${gainColor}`}>
                      {fund.gain_loss >= 0 ? '+' : ''}{fund.gain_loss.toLocaleString()}円
                      {fund.gain_loss_rate !== null && fund.gain_loss_rate !== undefined
                        ? ` (${(fund.gain_loss_rate * 100).toFixed(1)}%)`
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="mt-1 flex justify-end">
                  <button onClick={() => handleDelete(fund.id)} className="text-xs text-danger">削除</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
