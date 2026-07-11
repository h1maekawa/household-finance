'use client'
import { ChangeEvent, useState } from 'react'
import { FundHolding } from '@/types/fund'
import { StockWithQuote } from '@/types/stock'
import { readRakutenFundCsv, readRakutenFundTransactions } from '@/lib/rakuten-fund-csv'
import { readRakutenStockCsv, readRakutenStockTransactions } from '@/lib/rakuten-stock-csv'
import { useToast } from '@/components/Toast'

interface Props {
  mode: 'holdings' | 'history'
  holdings: StockWithQuote[]
  funds: FundHolding[]
  onMutate: () => void
}

export default function InvestmentCsvImportPanel({ mode, holdings, funds, onMutate }: Props) {
  const { showToast } = useToast()
  const [importing, setImporting] = useState(false)

  async function importHoldings(file: File) {
    const [stocks, fundItems] = await Promise.all([
      readRakutenStockCsv(file),
      readRakutenFundCsv(file),
    ])

    if (stocks.length === 0 && fundItems.length === 0) {
      showToast('保有残高CSVから保有商品を読み取れませんでした', 'warning')
      return
    }

    let stockChanged = 0
    let fundChanged = 0

    for (const item of stocks) {
      const existing = holdings.find(h => h.ticker.toUpperCase() === item.ticker.toUpperCase() && h.market === item.market)
      const res = await fetch(existing ? `/api/stocks/${existing.id}` : '/api/stocks', {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '株式の取込に失敗しました')
      stockChanged += 1
    }

    for (const item of fundItems) {
      const existing = funds.find(fund => fund.name === item.name && (fund.account_type ?? '') === (item.account_type ?? ''))
      const res = await fetch(existing ? `/api/funds/${existing.id}` : '/api/funds', {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '投資信託の取込に失敗しました')
      fundChanged += 1
    }

    showToast(`保有残高CSVを反映しました: 株式${stockChanged}件 / 投信${fundChanged}件`, 'success')
    onMutate()
  }

  async function importHistory(file: File, type: 'stock' | 'fund') {
    const transactions = type === 'stock'
      ? await readRakutenStockTransactions(file)
      : await readRakutenFundTransactions(file)

    if (transactions.length === 0) {
      showToast(type === 'stock' ? '米国株取引履歴を読み取れませんでした' : '投信取引履歴を読み取れませんでした', 'warning')
      return
    }

    const res = await fetch('/api/investment-transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions }),
    })
    if (!res.ok) throw new Error((await res.json()).error ?? '取引履歴の保存に失敗しました')
    showToast(`取引履歴を反映しました: ${transactions.length}件`, 'success')
    onMutate()
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>, type?: 'stock' | 'fund') {
    const file = event.target.files?.[0]
    if (!file) return

    setImporting(true)
    try {
      if (mode === 'holdings') await importHoldings(file)
      else if (type) await importHistory(file, type)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CSV取込に失敗しました', 'error')
    } finally {
      setImporting(false)
      event.target.value = ''
    }
  }

  if (mode === 'holdings') {
    return (
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold">保有残高CSV</p>
            <p className="mt-1 text-xs text-muted">assetbalance(all) を1回取り込めば、株式と投信をまとめて更新します</p>
          </div>
          <label className={`shrink-0 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-white active:opacity-80 ${importing ? 'opacity-50' : ''}`}>
            {importing ? '取込中...' : '取込'}
            <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={importing} className="hidden" />
          </label>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-4">
      <p className="text-sm font-bold">取引履歴CSV</p>
      <p className="mt-1 text-xs text-muted">tradehistory は株式と投信で分かれているので、それぞれ取り込みます</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className={`rounded-xl border border-border px-3 py-2 text-center text-sm font-bold text-primary active:opacity-80 ${importing ? 'opacity-50' : ''}`}>
          米国株
          <input type="file" accept=".csv,text/csv" onChange={e => handleFile(e, 'stock')} disabled={importing} className="hidden" />
        </label>
        <label className={`rounded-xl border border-border px-3 py-2 text-center text-sm font-bold text-primary active:opacity-80 ${importing ? 'opacity-50' : ''}`}>
          投信
          <input type="file" accept=".csv,text/csv" onChange={e => handleFile(e, 'fund')} disabled={importing} className="hidden" />
        </label>
      </div>
    </div>
  )
}
