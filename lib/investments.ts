import type {
  AccountPerformance,
  EarningsCalendarItem,
  HoldingPerformance,
  InvestmentDataset,
  InvestmentHolding,
  InvestmentCurrency,
  InvestmentMarket,
  NewsItem,
  RakutenImportResult,
  SectorHeatmapBlock,
  StockTransaction,
  WatchlistItem,
} from '@/types/investment'

const DEFAULT_USD_JPY = 158

export const sampleInvestmentData: InvestmentDataset = {
  usdJpy: DEFAULT_USD_JPY,
  portfolios: [
    { id: 'rakuten-us', account_type: '米国株', broker: '楽天証券', label: '楽天証券 米国株' },
    { id: 'rakuten-jp', account_type: '国内株', broker: '楽天証券', label: '楽天証券 国内株' },
  ],
  holdings: [
    {
      id: 'holding-aapl',
      portfolio_id: 'rakuten-us',
      ticker: 'AAPL',
      name: 'Apple',
      market: 'US',
      sector: 'Technology',
      quantity: 10,
      avg_cost: 150,
      current_price: 195.2,
      currency: 'USD',
      day_change_rate: 0.012,
    },
    {
      id: 'holding-nvda',
      portfolio_id: 'rakuten-us',
      ticker: 'NVDA',
      name: 'NVIDIA',
      market: 'US',
      sector: 'Semiconductors',
      quantity: 8,
      avg_cost: 96,
      current_price: 126.4,
      currency: 'USD',
      day_change_rate: 0.031,
    },
    {
      id: 'holding-7203',
      portfolio_id: 'rakuten-jp',
      ticker: '7203',
      name: 'トヨタ自動車',
      market: 'JP',
      sector: '自動車',
      quantity: 100,
      avg_cost: 2800,
      current_price: 3150,
      currency: 'JPY',
      day_change_rate: -0.006,
    },
  ],
  transactions: [],
  watchlist: [
    {
      id: 'watch-msft',
      ticker: 'MSFT',
      name: 'Microsoft',
      market: 'US',
      sector: 'Technology',
      added_date: '2026-06-15',
      added_price: 468,
      current_price: 482,
      currency: 'USD',
      memo: 'AI収益化の進捗を確認',
    },
    {
      id: 'watch-6758',
      ticker: '6758',
      name: 'ソニーグループ',
      market: 'JP',
      sector: '電機',
      added_date: '2026-06-21',
      added_price: 3720,
      current_price: 3655,
      currency: 'JPY',
      memo: 'ゲーム事業と為替感応度',
    },
  ],
  news: [
    {
      id: 'news-nvda-earnings',
      source: 'Reuters',
      ticker_tags: ['NVDA'],
      related_tickers: ['AMD', 'TSM'],
      headline: 'NVIDIA、データセンター需要の強さで市場予想を上回る見通し',
      url: 'https://www.reuters.com/',
      published_at: '2026-07-02T08:30:00+09:00',
      importance_score: 88,
      category: 'company',
      audience: 'holding',
    },
    {
      id: 'news-boj',
      source: 'Nikkei',
      ticker_tags: [],
      related_tickers: ['7203', '6758'],
      headline: '日銀、次回会合で追加利上げの是非を議論へ',
      url: 'https://www.nikkei.com/',
      published_at: '2026-07-02T07:10:00+09:00',
      importance_score: 76,
      category: 'macro',
      audience: 'macro',
    },
    {
      id: 'news-aapl',
      source: 'Yahoo Finance',
      ticker_tags: ['AAPL'],
      related_tickers: [],
      headline: 'Apple、新型端末の初期出荷計画を小幅に引き上げ',
      url: 'https://finance.yahoo.com/',
      published_at: '2026-07-01T22:15:00+09:00',
      importance_score: 64,
      category: 'company',
      audience: 'holding',
    },
    {
      id: 'news-msft-watch',
      source: 'MarketWatch',
      ticker_tags: ['MSFT'],
      related_tickers: ['AAPL'],
      headline: 'Microsoft、クラウド価格改定の影響を次回決算で開示へ',
      url: 'https://www.marketwatch.com/',
      published_at: '2026-07-01T19:40:00+09:00',
      importance_score: 57,
      category: 'company',
      audience: 'watchlist',
    },
  ],
  earnings: [
    {
      id: 'earn-aapl',
      ticker: 'AAPL',
      name: 'Apple',
      announce_date: '2026-07-30',
      timing: 'AMO',
      eps_estimate: 1.42,
      revenue_estimate: '$89.1B',
    },
    {
      id: 'earn-7203',
      ticker: '7203',
      name: 'トヨタ自動車',
      announce_date: '2026-08-04',
      timing: '場後',
      eps_estimate: 92.4,
      revenue_estimate: '11.2兆円',
    },
    {
      id: 'earn-nvda',
      ticker: 'NVDA',
      name: 'NVIDIA',
      announce_date: '2026-08-26',
      timing: 'AMO',
      eps_estimate: 0.98,
      revenue_estimate: '$44.6B',
    },
  ],
}

export function getHoldingPerformance(
  holding: InvestmentHolding,
  usdJpy = DEFAULT_USD_JPY,
): HoldingPerformance {
  const fx = holding.currency === 'USD' ? usdJpy : 1
  const cost_basis = holding.avg_cost * holding.quantity
  const market_value_local = holding.current_price * holding.quantity
  const market_value_jpy = Math.round(market_value_local * fx)
  const unrealized_pnl_local = market_value_local - cost_basis
  const unrealized_pnl_jpy = Math.round(unrealized_pnl_local * fx)
  const unrealized_pnl_rate = cost_basis > 0 ? unrealized_pnl_local / cost_basis : 0

  return {
    ...holding,
    cost_basis,
    market_value_local,
    market_value_jpy,
    unrealized_pnl_local,
    unrealized_pnl_jpy,
    unrealized_pnl_rate,
  }
}

export function getAccountPerformance(dataset: InvestmentDataset): AccountPerformance[] {
  return dataset.portfolios.map(portfolio => {
    const holdings = dataset.holdings
      .filter(holding => holding.portfolio_id === portfolio.id)
      .map(holding => getHoldingPerformance(holding, dataset.usdJpy))

    return {
      portfolio,
      holdings,
      market_value_jpy: holdings.reduce((sum, holding) => sum + holding.market_value_jpy, 0),
      unrealized_pnl_jpy: holdings.reduce((sum, holding) => sum + holding.unrealized_pnl_jpy, 0),
    }
  })
}

export function getInvestmentSummary(dataset: InvestmentDataset) {
  const holdings = dataset.holdings.map(holding => getHoldingPerformance(holding, dataset.usdJpy))
  const investmentValue = holdings.reduce((sum, holding) => sum + holding.market_value_jpy, 0)
  const dayPnl = holdings.reduce((sum, holding) => {
    const previous = holding.market_value_jpy / (1 + holding.day_change_rate)
    return sum + Math.round(holding.market_value_jpy - previous)
  }, 0)
  const unreadHighImportanceNews = dataset.news.filter(news => news.importance_score >= 80).length

  return { investmentValue, dayPnl, unreadHighImportanceNews }
}

export function getSectorHeatmap(dataset: InvestmentDataset, market: InvestmentMarket): SectorHeatmapBlock[] {
  const groups = new Map<string, SectorHeatmapBlock>()
  dataset.holdings
    .filter(holding => holding.market === market)
    .forEach(holding => {
      const performance = getHoldingPerformance(holding, dataset.usdJpy)
      const existing = groups.get(holding.sector) ?? {
        sector: holding.sector,
        market,
        value_jpy: 0,
        day_change_rate: 0,
        holdings_count: 0,
      }
      const nextValue = existing.value_jpy + performance.market_value_jpy
      const weightedChange = existing.value_jpy * existing.day_change_rate
        + performance.market_value_jpy * holding.day_change_rate

      groups.set(holding.sector, {
        ...existing,
        value_jpy: nextValue,
        day_change_rate: nextValue > 0 ? weightedChange / nextValue : 0,
        holdings_count: existing.holdings_count + 1,
      })
    })

  return Array.from(groups.values()).sort((a, b) => b.value_jpy - a.value_jpy)
}

export async function readRakutenCsv(file: File): Promise<InvestmentHolding[]> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const decoded = hasBom || looksLikeUtf8(utf8)
    ? utf8.replace(/^\uFEFF/, '')
    : new TextDecoder('shift-jis').decode(bytes)

  return parseRakutenCsv(decoded)
}

export function parseRakutenCsv(text: string): InvestmentHolding[] {
  const rows = parseCsvRows(text).filter(row => row.some(cell => cell.trim()))
  if (rows.length < 2) return []

  const headers = rows[0].map(normalizeHeader)
  const isUs = headers.includes('ティッカー') || headers.includes('取得単価(USD)')
  const portfolio_id = isUs ? 'rakuten-us' : 'rakuten-jp'
  const market: InvestmentMarket = isUs ? 'US' : 'JP'
  const currency: InvestmentCurrency = isUs ? 'USD' : 'JPY'

  return rows.slice(1).map((row, index) => {
    const get = (name: string) => row[headers.indexOf(name)] ?? ''
    const ticker = isUs ? get('ティッカー') : get('銘柄コード')
    const avgCostHeader = isUs ? '取得単価(USD)' : '取得単価'
    const currentPriceHeader = isUs ? '現在値(USD)' : '現在値'

    return {
      id: `import-${ticker || index}-${Date.now()}`,
      portfolio_id,
      ticker: ticker.trim().toUpperCase(),
      name: get('銘柄名').trim(),
      market,
      sector: isUs ? 'Unclassified' : '未分類',
      quantity: parseNumber(get('保有数量')),
      avg_cost: parseNumber(get(avgCostHeader)),
      current_price: parseNumber(get(currentPriceHeader)),
      currency,
      day_change_rate: 0,
    }
  }).filter(holding => holding.ticker && holding.quantity >= 0)
}

export function mergeImportedHoldings(
  existing: InvestmentHolding[],
  imported: InvestmentHolding[],
): RakutenImportResult {
  const transactions: StockTransaction[] = []
  let added = 0
  let updated = 0
  let reduced = 0
  let closed = 0

  const byKey = new Map(existing.map(holding => [holdingKey(holding), holding]))
  const next = existing.slice()

  imported.forEach(importedHolding => {
    const key = holdingKey(importedHolding)
    const current = byKey.get(key)

    if (!current) {
      added += 1
      next.push(importedHolding)
      transactions.push(toTransaction(importedHolding, 'buy', importedHolding.quantity, 0))
      return
    }

    const delta = importedHolding.quantity - current.quantity
    if (delta > 0) {
      transactions.push(toTransaction(importedHolding, 'buy', delta, 0))
    } else if (delta < 0) {
      reduced += 1
      if (importedHolding.quantity === 0) closed += 1
      const soldQuantity = Math.abs(delta)
      const realized = (importedHolding.current_price - current.avg_cost) * soldQuantity
      transactions.push(toTransaction(importedHolding, 'sell', soldQuantity, realized))
    }

    updated += 1
    const index = next.findIndex(holding => holdingKey(holding) === key)
    next[index] = { ...current, ...importedHolding, id: current.id }
  })

  return { holdings: next, transactions, added, updated, reduced, closed }
}

export function addWatchlistItem(items: WatchlistItem[], item: Omit<WatchlistItem, 'id' | 'added_date'>): WatchlistItem[] {
  return [
    {
      ...item,
      id: `watch-${item.ticker}-${Date.now()}`,
      added_date: new Date().toISOString().slice(0, 10),
    },
    ...items,
  ]
}

export function filterNews(news: NewsItem[], audience: 'holding' | 'watchlist' | 'macro', minimumScore = 50) {
  return news
    .filter(item => item.importance_score >= minimumScore)
    .filter(item => audience === 'macro' ? item.category === 'macro' : item.audience === audience)
    .sort((a, b) => b.importance_score - a.importance_score)
}

export function getUpcomingEarnings(items: EarningsCalendarItem[]) {
  return items.slice().sort((a, b) => a.announce_date.localeCompare(b.announce_date))
}

function toTransaction(
  holding: InvestmentHolding,
  type: 'buy' | 'sell',
  quantity: number,
  realized_pnl: number,
): StockTransaction {
  return {
    id: `tx-${holding.ticker}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    holding_id: holding.id,
    type,
    quantity,
    price: type === 'buy' ? holding.avg_cost : holding.current_price,
    currency: holding.currency,
    transaction_date: new Date().toISOString().slice(0, 10),
    realized_pnl,
  }
}

function holdingKey(holding: InvestmentHolding) {
  return `${holding.market}:${holding.ticker.toUpperCase()}`
}

function looksLikeUtf8(text: string) {
  return !text.includes('\uFFFD')
}

function normalizeHeader(header: string) {
  return header.trim().replace(/^\uFEFF/, '')
}

function parseNumber(value: string) {
  const normalized = value.replace(/[,"%円株\s]/g, '').replace(/△/g, '-')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseCsvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"' && quoted && next === '"') {
      cell += '"'
      i += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}
