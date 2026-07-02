'use client'

import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import {
  addWatchlistItem,
  filterNews,
  getAccountPerformance,
  getHoldingPerformance,
  getInvestmentSummary,
  getSectorHeatmap,
  getUpcomingEarnings,
  mergeImportedHoldings,
  readRakutenCsv,
  sampleInvestmentData,
} from '@/lib/investments'
import type { InvestmentDataset, InvestmentMarket, WatchlistItem } from '@/types/investment'
import { useToast } from '@/components/Toast'

type ViewKey = 'portfolio' | 'watchlist' | 'news' | 'earnings' | 'heatmap'
type AccountFilter = 'all' | string
type CurrencyView = 'jpy' | 'local'
type NewsTab = 'holding' | 'watchlist' | 'macro'

const storageKey = 'personal-finance-investments-v1'

const views: { key: ViewKey; label: string }[] = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'news', label: 'News' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'heatmap', label: 'Heatmap' },
]

export default function InvestmentModule() {
  const { showToast } = useToast()
  const [dataset, setDataset] = useState<InvestmentDataset>(() => {
    if (typeof window === 'undefined') return sampleInvestmentData

    const stored = window.localStorage.getItem(storageKey)
    if (!stored) return sampleInvestmentData

    try {
      return JSON.parse(stored) as InvestmentDataset
    } catch {
      window.localStorage.removeItem(storageKey)
      return sampleInvestmentData
    }
  })
  const [view, setView] = useState<ViewKey>('portfolio')
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all')
  const [currencyView, setCurrencyView] = useState<CurrencyView>('jpy')
  const [newsTab, setNewsTab] = useState<NewsTab>('holding')
  const [heatmapMarket, setHeatmapMarket] = useState<InvestmentMarket>('US')
  const [watchForm, setWatchForm] = useState({
    ticker: '',
    name: '',
    market: 'US' as InvestmentMarket,
    sector: '',
    added_price: '',
    current_price: '',
    memo: '',
  })

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(dataset))
  }, [dataset])

  const accounts = useMemo(() => getAccountPerformance(dataset), [dataset])
  const summary = useMemo(() => getInvestmentSummary(dataset), [dataset])
  const holdings = useMemo(() => {
    const filtered = accountFilter === 'all'
      ? dataset.holdings
      : dataset.holdings.filter(holding => holding.portfolio_id === accountFilter)
    return filtered.map(holding => getHoldingPerformance(holding, dataset.usdJpy))
  }, [accountFilter, dataset])
  const visibleNews = useMemo(() => filterNews(dataset.news, newsTab), [dataset.news, newsTab])
  const heatmap = useMemo(() => getSectorHeatmap(dataset, heatmapMarket), [dataset, heatmapMarket])

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const imported = await readRakutenCsv(file)
      const result = mergeImportedHoldings(dataset.holdings, imported)
      setDataset(current => ({
        ...current,
        holdings: result.holdings,
        transactions: [...result.transactions, ...current.transactions],
      }))
      showToast(
        `CSVを反映しました: 新規${result.added}件 / 更新${result.updated}件 / 売却${result.reduced}件`,
        'success',
      )
    } catch {
      showToast('CSVの読み込みに失敗しました', 'error')
    } finally {
      event.target.value = ''
    }
  }

  function handleAddWatchlist() {
    if (!watchForm.ticker || !watchForm.name) {
      showToast('ティッカーと銘柄名を入力してください', 'warning')
      return
    }

    const currency = watchForm.market === 'US' ? 'USD' : 'JPY'
    const item: Omit<WatchlistItem, 'id' | 'added_date'> = {
      ticker: watchForm.ticker.toUpperCase(),
      name: watchForm.name,
      market: watchForm.market,
      sector: watchForm.sector || '未分類',
      added_price: Number(watchForm.added_price) || 0,
      current_price: Number(watchForm.current_price) || Number(watchForm.added_price) || 0,
      currency,
      memo: watchForm.memo,
    }

    setDataset(current => ({ ...current, watchlist: addWatchlistItem(current.watchlist, item) }))
    setWatchForm({
      ticker: '',
      name: '',
      market: 'US',
      sector: '',
      added_price: '',
      current_price: '',
      memo: '',
    })
    showToast('ウォッチリストに追加しました', 'success')
  }

  function removeWatchlistItem(id: string) {
    setDataset(current => ({ ...current, watchlist: current.watchlist.filter(item => item.id !== id) }))
    showToast('ウォッチリストから削除しました', 'success')
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="px-4 pt-10 pb-4 bg-card border-b border-border">
        <p className="text-xs text-muted mb-1">Investments</p>
        <h1 className="text-xl font-bold">投資管理</h1>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <SummaryTile label="投資評価額" value={`${formatJpy(summary.investmentValue)}円`} />
          <SummaryTile
            label="本日の損益"
            value={`${summary.dayPnl >= 0 ? '+' : ''}${formatJpy(summary.dayPnl)}円`}
            tone={summary.dayPnl >= 0 ? 'up' : 'down'}
          />
          <SummaryTile label="重要ニュース" value={`${summary.unreadHighImportanceNews}件`} tone="alert" />
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4">
        <div className="overflow-x-auto -mx-4 px-4">
          <div className="inline-flex gap-1 rounded-lg bg-white border border-border p-1 min-w-max">
            {views.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setView(item.key)}
                className={`px-3 py-2 rounded-md text-xs font-bold transition-base ${
                  view === item.key ? 'bg-primary text-white' : 'text-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {view === 'portfolio' && (
          <PortfolioView
            accounts={accounts}
            holdings={holdings}
            accountFilter={accountFilter}
            setAccountFilter={setAccountFilter}
            currencyView={currencyView}
            setCurrencyView={setCurrencyView}
            usdJpy={dataset.usdJpy}
            onCsvUpload={handleCsvUpload}
          />
        )}

        {view === 'watchlist' && (
          <WatchlistView
            items={dataset.watchlist}
            form={watchForm}
            setForm={setWatchForm}
            onAdd={handleAddWatchlist}
            onRemove={removeWatchlistItem}
          />
        )}

        {view === 'news' && (
          <NewsView news={visibleNews} tab={newsTab} setTab={setNewsTab} />
        )}

        {view === 'earnings' && (
          <EarningsView items={getUpcomingEarnings(dataset.earnings)} />
        )}

        {view === 'heatmap' && (
          <HeatmapView
            blocks={heatmap}
            market={heatmapMarket}
            setMarket={setHeatmapMarket}
          />
        )}
      </div>
    </div>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'alert' }) {
  const toneClass = tone === 'up' ? 'text-success' : tone === 'down' ? 'text-danger' : tone === 'alert' ? 'text-warning' : ''
  return (
    <div className="bg-surface border border-border rounded-lg p-2 min-w-0">
      <p className="text-[10px] text-muted mb-1 truncate">{label}</p>
      <p className={`text-sm font-bold leading-tight break-words ${toneClass}`}>{value}</p>
    </div>
  )
}

function PortfolioView({
  accounts,
  holdings,
  accountFilter,
  setAccountFilter,
  currencyView,
  setCurrencyView,
  usdJpy,
  onCsvUpload,
}: {
  accounts: ReturnType<typeof getAccountPerformance>
  holdings: ReturnType<typeof getHoldingPerformance>[]
  accountFilter: AccountFilter
  setAccountFilter: (value: AccountFilter) => void
  currencyView: CurrencyView
  setCurrencyView: (value: CurrencyView) => void
  usdJpy: number
  onCsvUpload: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-bold text-base">ポートフォリオ</h2>
          <label className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold active:opacity-80">
            CSV取込
            <input type="file" accept=".csv,text/csv" onChange={onCsvUpload} className="hidden" />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <button
            type="button"
            onClick={() => setAccountFilter('all')}
            className={`rounded-lg border px-2 py-2 text-xs font-bold ${accountFilter === 'all' ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-muted'}`}
          >
            全体
          </button>
          {accounts.map(account => (
            <button
              key={account.portfolio.id}
              type="button"
              onClick={() => setAccountFilter(account.portfolio.id)}
              className={`rounded-lg border px-2 py-2 text-xs font-bold ${accountFilter === account.portfolio.id ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-muted'}`}
            >
              {account.portfolio.account_type}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setCurrencyView('jpy')}
            className={`rounded-lg border px-3 py-2 text-xs font-bold ${currencyView === 'jpy' ? 'bg-foreground text-white border-foreground' : 'bg-surface border-border text-muted'}`}
          >
            円換算
          </button>
          <button
            type="button"
            onClick={() => setCurrencyView('local')}
            className={`rounded-lg border px-3 py-2 text-xs font-bold ${currencyView === 'local' ? 'bg-foreground text-white border-foreground' : 'bg-surface border-border text-muted'}`}
          >
            現地通貨
          </button>
        </div>
        <p className="text-xs text-muted mt-3">USD/JPY {usdJpy.toLocaleString()}で円換算</p>
      </section>

      <section className="card overflow-hidden">
        {holdings.map((holding, index) => {
          const pnlColor = holding.unrealized_pnl_jpy >= 0 ? 'text-success' : 'text-danger'
          const localSymbol = holding.currency === 'USD' ? '$' : '円'
          const value = currencyView === 'jpy'
            ? `${formatJpy(holding.market_value_jpy)}円`
            : `${localSymbol}${formatNumber(holding.market_value_local)}`
          const pnl = currencyView === 'jpy'
            ? `${holding.unrealized_pnl_jpy >= 0 ? '+' : ''}${formatJpy(holding.unrealized_pnl_jpy)}円`
            : `${holding.unrealized_pnl_local >= 0 ? '+' : ''}${localSymbol}${formatNumber(holding.unrealized_pnl_local)}`

          return (
            <div key={holding.id} className={`px-4 py-3 ${index < holdings.length - 1 ? 'border-b border-border' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 rounded bg-surface text-[11px] font-mono text-muted">{holding.ticker}</span>
                    <span className="text-[11px] text-muted">{holding.market === 'US' ? '米国' : '日本'} · {holding.sector}</span>
                  </div>
                  <p className="text-sm font-bold truncate">{holding.name}</p>
                  <p className="text-xs text-muted">
                    {formatNumber(holding.quantity)}株 · 取得 {holding.currency === 'USD' ? '$' : ''}{formatNumber(holding.avg_cost)}{holding.currency === 'JPY' ? '円' : ''}
                  </p>
                </div>
                <div className="text-right shrink-0 max-w-[44%]">
                  <p className="text-sm font-bold break-words">{value}</p>
                  <p className={`text-xs font-bold ${pnlColor}`}>
                    {pnl} ({formatPercent(holding.unrealized_pnl_rate)})
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}

function WatchlistView({
  items,
  form,
  setForm,
  onAdd,
  onRemove,
}: {
  items: WatchlistItem[]
  form: {
    ticker: string
    name: string
    market: InvestmentMarket
    sector: string
    added_price: string
    current_price: string
    memo: string
  }
  setForm: (value: typeof form | ((current: typeof form) => typeof form)) => void
  onAdd: () => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4">
        <h2 className="font-bold text-base mb-3">ウォッチリスト追加</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ティッカー" value={form.ticker} onChange={value => setForm(current => ({ ...current, ticker: value.toUpperCase() }))} />
          <label>
            <span className="text-xs text-muted mb-1 block">市場</span>
            <select
              value={form.market}
              onChange={event => setForm(current => ({ ...current, market: event.target.value as InvestmentMarket }))}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="US">米国</option>
              <option value="JP">日本</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="銘柄名" value={form.name} onChange={value => setForm(current => ({ ...current, name: value }))} />
          <Field label="セクター" value={form.sector} onChange={value => setForm(current => ({ ...current, sector: value }))} />
          <Field label="追加時株価" value={form.added_price} type="number" onChange={value => setForm(current => ({ ...current, added_price: value }))} />
          <Field label="現在値" value={form.current_price} type="number" onChange={value => setForm(current => ({ ...current, current_price: value }))} />
        </div>
        <div className="mt-3">
          <Field label="メモ" value={form.memo} onChange={value => setForm(current => ({ ...current, memo: value }))} />
        </div>
        <button type="button" onClick={onAdd} className="w-full mt-4 py-3 rounded-lg bg-primary text-white text-sm font-bold">
          追加
        </button>
      </section>

      <section className="card overflow-hidden">
        {items.map((item, index) => {
          const change = item.added_price > 0 ? (item.current_price - item.added_price) / item.added_price : 0
          const color = change >= 0 ? 'text-success' : 'text-danger'
          return (
            <div key={item.id} className={`px-4 py-3 ${index < items.length - 1 ? 'border-b border-border' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{item.ticker} · {item.name}</p>
                  <p className="text-xs text-muted truncate">{item.sector} · {item.memo || 'メモなし'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold ${color}`}>{formatPercent(change)}</p>
                  <button type="button" onClick={() => onRemove(item.id)} className="text-xs text-danger mt-1">削除</button>
                </div>
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}

function NewsView({ news, tab, setTab }: { news: ReturnType<typeof filterNews>; tab: NewsTab; setTab: (tab: NewsTab) => void }) {
  const tabs: { key: NewsTab; label: string }[] = [
    { key: 'holding', label: '保有銘柄' },
    { key: 'watchlist', label: 'ウォッチ' },
    { key: 'macro', label: 'マクロ' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {tabs.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-lg border px-2 py-2 text-xs font-bold ${tab === item.key ? 'bg-primary text-white border-primary' : 'bg-card border-border text-muted'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="card overflow-hidden">
        {news.map((item, index) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className={`block px-4 py-3 ${index < news.length - 1 ? 'border-b border-border' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted mb-1">{item.source} · {new Date(item.published_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                <p className="text-sm font-bold leading-snug">{item.headline}</p>
                <p className="text-xs text-muted mt-2 truncate">
                  tags: {[...item.ticker_tags, ...item.related_tickers.map(ticker => `相関:${ticker}`)].join(' / ') || 'macro'}
                </p>
              </div>
              <ScoreBadge score={item.importance_score} />
            </div>
          </a>
        ))}
      </section>
    </div>
  )
}

function EarningsView({ items }: { items: ReturnType<typeof getUpcomingEarnings> }) {
  return (
    <section className="card overflow-hidden">
      {items.map((item, index) => (
        <div key={item.id} className={`px-4 py-3 ${index < items.length - 1 ? 'border-b border-border' : ''}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{item.ticker} · {item.name}</p>
              <p className="text-xs text-muted">EPS予想 {item.eps_estimate ?? '-'} · 売上予想 {item.revenue_estimate ?? '-'}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold">{item.announce_date.slice(5).replace('-', '/')}</p>
              <p className="text-xs text-muted">{item.timing}</p>
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}

function HeatmapView({
  blocks,
  market,
  setMarket,
}: {
  blocks: ReturnType<typeof getSectorHeatmap>
  market: InvestmentMarket
  setMarket: (market: InvestmentMarket) => void
}) {
  const max = Math.max(...blocks.map(block => block.value_jpy), 1)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        {(['US', 'JP'] as InvestmentMarket[]).map(item => (
          <button
            key={item}
            type="button"
            onClick={() => setMarket(item)}
            className={`rounded-lg border px-2 py-2 text-xs font-bold ${market === item ? 'bg-primary text-white border-primary' : 'bg-card border-border text-muted'}`}
          >
            {item === 'US' ? '米国株' : '日本株'}
          </button>
        ))}
      </div>

      <section className="grid grid-cols-2 gap-2">
        {blocks.map(block => {
          const size = Math.max(96, Math.round(96 + (block.value_jpy / max) * 76))
          const bg = block.day_change_rate >= 0 ? 'bg-emerald-50 border-success' : 'bg-red-50 border-danger'
          const text = block.day_change_rate >= 0 ? 'text-success' : 'text-danger'
          return (
            <button
              key={block.sector}
              type="button"
              className={`border rounded-lg p-3 text-left ${bg}`}
              style={{ minHeight: size }}
            >
              <p className="text-sm font-bold text-foreground">{block.sector}</p>
              <p className="text-xs text-muted mt-1">{block.holdings_count}銘柄 · {formatJpy(block.value_jpy)}円</p>
              <p className={`text-lg font-bold mt-3 ${text}`}>{formatPercent(block.day_change_rate)}</p>
            </button>
          )
        })}
      </section>
    </div>
  )
}

function Field({
  label,
  value,
  type = 'text',
  onChange,
}: {
  label: string
  value: string
  type?: string
  onChange: (value: string) => void
}) {
  return (
    <label>
      <span className="text-xs text-muted mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
      />
    </label>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const className = score >= 80 ? 'bg-warning text-white' : score >= 50 ? 'bg-primary text-white' : 'bg-surface text-muted'
  return (
    <div className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center shrink-0 ${className}`}>
      <span className="text-[10px] leading-none">score</span>
      <span className="text-sm font-bold">{score}</span>
    </div>
  )
}

function formatNumber(value: number) {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatJpy(value: number) {
  return Math.round(value).toLocaleString()
}

function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}
