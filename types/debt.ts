// types/debt.ts

export type DebtDirection = 'borrowed' | 'lent' // borrowed=借りている金, lent=貸している金

export interface Debt {
  id: string
  direction: DebtDirection
  counterparty: string
  amount: number
  date: string            // YYYY-MM-DD
  due_date?: string | null
  memo?: string | null
  is_settled: boolean
  created_at: string
  updated_at: string
}

export interface DebtInput {
  direction: DebtDirection
  counterparty: string
  amount: number
  date: string
  due_date?: string | null
  memo?: string | null
  is_settled?: boolean
}
