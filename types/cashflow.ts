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
  type: 'fixed' | 'credit' | 'income'
  is_active: boolean
  memo?: string
  last_paid_month?: string | null // 'YYYY-MM'。直近どの月まで支払い済みか
  scheduled_date?: string
  generated?: boolean
  source?: 'manual' | 'credit_card' | 'monthly_income' | 'gmail_bank'
  external_id?: string | null
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
  last_paid_month?: string | null
  scheduled_date?: string
  external_id?: string | null
}

export interface DailyBalance {
  date: string           // YYYY-MM-DD
  balance: number
  payments: ScheduledPayment[]  // その日の引き落とし
  isNegative: boolean
}

export interface CreditCardSetting {
  id: string
  name: string
  closing_day: string
  payment_day: string
  closing_day_int?: number | null
  payment_day_int?: number | null
  payment_month_offset?: number | null
  created_at: string
}

export interface CashflowProfile {
  initial_balance: number
  monthly_income: number
  income_day?: number | null
}

export interface CashflowResponse {
  currentBalance: AccountBalance | null
  projectedDays: DailyBalance[]
  scheduledPayments: ScheduledPayment[]
  generatedPayments: ScheduledPayment[]
  creditCards: CreditCardSetting[]
  profile: CashflowProfile
}
