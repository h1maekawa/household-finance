// types/stock.ts

export type StockMarket = 'JP' | 'US'

export interface StockHolding {
  id: string
  ticker: string
  name: string
  market: StockMarket
  shares: number
  average_cost: number   // 平均取得単価（円）
  broker_current_value?: number | null
  broker_gain_loss?: number | null
  broker_gain_loss_rate?: number | null
  broker_current_price?: number | null
  broker_price_currency?: string | null
  broker_fx_rate?: number | null
  broker_snapshot_at?: string | null
  created_at: string
  updated_at: string
}

export interface StockHoldingInput {
  ticker: string
  name: string
  market: StockMarket
  shares: number
  average_cost: number
  broker_current_value?: number | null
  broker_gain_loss?: number | null
  broker_gain_loss_rate?: number | null
  broker_current_price?: number | null
  broker_price_currency?: string | null
  broker_fx_rate?: number | null
  broker_snapshot_at?: string | null
}

export interface StockQuote {
  ticker: string
  price: number
  change: number          // 前日比(現地通貨)
  currency: string
  updatedAt: Date | undefined
}

export interface StockWithQuote extends StockHolding {
  currentPrice: number | null
  currentValue: number | null    // 現在評価額（円）
  gainLoss: number | null        // 損益（円）
  gainLossRate: number | null    // 損益率（%）
  valueSource?: 'broker' | 'yahoo'
  yahooCurrentPrice?: number | null
  yahooCurrentValue?: number | null
  yahooGainLoss?: number | null
  yahooGainLossRate?: number | null
  error?: string
}

export interface AssetSummary {
  accountBalance: number
  stockValue: number
  totalAssets: number
  holdings: StockWithQuote[]
}
