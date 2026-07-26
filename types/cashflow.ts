// types/cashflow.ts

export interface AccountBalance {
  id: string
  balance: number
  recorded_at: string
}

/** 支払方法。'credit_card' は銀行引落を生まず、カード請求に合流する */
export type PaymentMethod = 'bank_debit' | 'credit_card' | 'cash' | 'other'

/** 支払日が土日祝のときの金融機関営業日補正 */
export type BusinessDayRule = 'none' | 'next' | 'previous'

export type Recurrence = 'monthly' | 'yearly' | 'once'

/** 固定費の通貨。外貨建ては foreign_amount × レートで円換算する */
export type PaymentCurrency = 'JPY' | 'USD'

export interface ScheduledPayment {
  id: string
  name: string
  amount: number
  due_day: number        // 毎月何日（1〜31）
  category: string
  type: 'fixed' | 'credit' | 'income'
  is_active: boolean
  memo?: string
  /** @deprecated 表示名のみ。引き落とし口座の真実は debit_account_id（migration 018〜020） */
  bank_account?: string | null
  debit_account_id?: string | null
  payment_method?: PaymentMethod
  credit_card_id?: string | null
  start_date?: string | null
  end_date?: string | null
  recurrence?: Recurrence
  business_day_rule?: BusinessDayRule
  currency?: PaymentCurrency
  /** 外貨建ての原資産額（例: 105 USD）。currency==='JPY' なら未使用 */
  foreign_amount?: number | null
  last_paid_month?: string | null // 'YYYY-MM'。直近どの月まで支払い済みか
  scheduled_date?: string
  generated?: boolean
  source?: 'manual' | 'credit_card' | 'monthly_income' | 'gmail_bank'
  external_id?: string | null
  created_at: string
}

/**
 * API が付与する解決済みの値。計算はサーバー側の純関数
 * （lib/services/fixed-costs.ts）に集約し、クライアントは再計算しない。
 */
export interface ResolvedScheduledPayment extends ScheduledPayment {
  /** 営業日補正・月末クランプ・契約期間を反映した次回引き落とし日。対象外の月は null */
  resolvedDueDate: string | null
  /** 外貨建てを円換算した実際の引き落とし額 */
  resolvedAmountYen: number
  /** 引き落とし口座の表示名。未設定なら null（＝「引落口座 未確認」） */
  debitAccountName: string | null
}

export interface ScheduledPaymentInput {
  name: string
  amount: number
  due_day: number
  category: string
  type: 'fixed' | 'credit'
  is_active?: boolean
  memo?: string
  bank_account?: string | null
  debit_account_id?: string | null
  payment_method?: PaymentMethod
  credit_card_id?: string | null
  start_date?: string | null
  end_date?: string | null
  recurrence?: Recurrence
  business_day_rule?: BusinessDayRule
  currency?: PaymentCurrency
  foreign_amount?: number | null
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
  /** @deprecated 表示名のみ。引き落とし口座の真実は debit_account_id（migration 018） */
  bank_account?: string | null
  debit_account_id?: string | null
  /** カード種別: 'rakuten' | 'smbc' | 'generic' */
  card_type?: string | null
  /** カードプラン: 'rakuten_standard' | 'rakuten_market' | 'smbc_10th' | 'smbc_26th' | 'generic' */
  card_plan?: string | null
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
