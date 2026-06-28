// types/cashflow.ts

export interface AccountBalance {
  id: string
  balance: number
  recorded_at: string
}

export interface ScheduledPayment {
  id: string
  name: string
  amount: number
  due_day: number        // 毎月何日（1〜31）
  category: string
  type: 'fixed' | 'credit'
  is_active: boolean
  memo?: string
  created_at: string
}

export interface ScheduledPaymentInput {
  name: string
  amount: number
  due_day: number
  category: string
  type: 'fixed' | 'credit'
  is_active?: boolean
  memo?: string
}

export interface DailyBalance {
  date: string           // YYYY-MM-DD
  balance: number
  payments: ScheduledPayment[]  // その日の引き落とし
  isNegative: boolean
}

export interface CashflowResponse {
  currentBalance: AccountBalance | null
  projectedDays: DailyBalance[]
  scheduledPayments: ScheduledPayment[]
}
