export type InvestmentAssetType = 'stock' | 'fund'

export interface InvestmentTransaction {
  id: string
  asset_type: InvestmentAssetType
  symbol?: string | null
  name: string
  account_type?: string | null
  trade_type: string
  trade_date: string
  settlement_date?: string | null
  quantity: number
  unit_price: number
  amount_jpy: number
  amount_foreign?: number | null
  currency: string
  fx_rate?: number | null
  source: string
  external_id: string
  created_at: string
}

export interface InvestmentTransactionInput {
  asset_type: InvestmentAssetType
  symbol?: string | null
  name: string
  account_type?: string | null
  trade_type: string
  trade_date: string
  settlement_date?: string | null
  quantity: number
  unit_price: number
  amount_jpy: number
  amount_foreign?: number | null
  currency: string
  fx_rate?: number | null
  source: string
  external_id: string
}
