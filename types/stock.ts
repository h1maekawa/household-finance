// types/stock.ts

export type StockMarket = 'JP' | 'US'

export interface StockHolding {
  id: string
  ticker: string
  name: string
  market: StockMarket
  shares: number
  average_cost: number   // 平均取得単価（円）
  created_at: string
  updated_at: string
}

export interface StockHoldingInput {
  ticker: string
  name: string
  market: StockMarket
  shares: number
  average_cost: number
}

export interface StockQuote {
  ticker: string
  price: number
  currency: string
  updatedAt: Date | undefined
}

export interface StockWithQuote extends StockHolding {
  currentPrice: number | null
  currentValue: number | null    // 現在評価額（円）
  gainLoss: number | null        // 損益（円）
  gainLossRate: number | null    // 損益率（%）
  error?: string
}

export interface AssetSummary {
  accountBalance: number
  stockValue: number
  totalAssets: number
  holdings: StockWithQuote[]
}
