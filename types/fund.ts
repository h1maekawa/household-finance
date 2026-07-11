export interface FundHolding {
  id: string
  name: string
  account_type?: string | null
  units: number
  average_cost: number
  base_price: number
  current_value: number
  gain_loss: number
  gain_loss_rate: number | null
  broker_snapshot_at?: string | null
  created_at: string
  updated_at: string
}

export interface FundHoldingInput {
  name: string
  account_type?: string | null
  units: number
  average_cost: number
  base_price: number
  current_value: number
  gain_loss: number
  gain_loss_rate?: number | null
  broker_snapshot_at?: string | null
}
