export type InvestmentMarket = 'US' | 'JP'
export type InvestmentCurrency = 'USD' | 'JPY'
export type InvestmentAccountType = '国内株' | '米国株'
export type NewsCategory = 'company' | 'macro'
export type NewsAudience = 'holding' | 'watchlist' | 'macro'
export type EarningsTiming = 'BMO' | 'AMO' | '場中' | '場後'
export type StockTransactionType = 'buy' | 'sell'

export interface InvestmentPortfolio {
  id: string
  account_type: InvestmentAccountType
  broker: string
  label: string
}

export interface InvestmentHolding {
  id: string
  portfolio_id: string
  ticker: string
  name: string
  market: InvestmentMarket
  sector: string
  quantity: number
  avg_cost: number
  current_price: number
  currency: InvestmentCurrency
  day_change_rate: number
}

export interface StockTransaction {
  id: string
  holding_id: string
  type: StockTransactionType
  quantity: number
  price: number
  currency: InvestmentCurrency
  transaction_date: string
  realized_pnl: number
}

export interface WatchlistItem {
  id: string
  ticker: string
  name: string
  market: InvestmentMarket
  sector: string
  added_date: string
  added_price: number
  current_price: number
  currency: InvestmentCurrency
  memo: string
}

export interface NewsItem {
  id: string
  source: string
  ticker_tags: string[]
  related_tickers: string[]
  headline: string
  url: string
  published_at: string
  importance_score: number
  category: NewsCategory
  audience: NewsAudience
}

export interface EarningsCalendarItem {
  id: string
  ticker: string
  name: string
  announce_date: string
  timing: EarningsTiming
  eps_estimate?: number
  revenue_estimate?: string
}

export interface HoldingPerformance extends InvestmentHolding {
  cost_basis: number
  market_value_local: number
  market_value_jpy: number
  unrealized_pnl_local: number
  unrealized_pnl_jpy: number
  unrealized_pnl_rate: number
}

export interface AccountPerformance {
  portfolio: InvestmentPortfolio
  market_value_jpy: number
  unrealized_pnl_jpy: number
  holdings: HoldingPerformance[]
}

export interface SectorHeatmapBlock {
  sector: string
  market: InvestmentMarket
  value_jpy: number
  day_change_rate: number
  holdings_count: number
}

export interface InvestmentSummary {
  investmentValue: number
  dayPnl: number
  unreadHighImportanceNews: number
}

export interface InvestmentDataset {
  portfolios: InvestmentPortfolio[]
  holdings: InvestmentHolding[]
  transactions: StockTransaction[]
  watchlist: WatchlistItem[]
  news: NewsItem[]
  earnings: EarningsCalendarItem[]
  usdJpy: number
}

export interface RakutenImportResult {
  holdings: InvestmentHolding[]
  transactions: StockTransaction[]
  added: number
  updated: number
  reduced: number
  closed: number
}
