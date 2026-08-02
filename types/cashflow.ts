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

/**
 * 金額が毎月同じか、月ごとに動くか。
 * 'variable' の amount は「予定額」であって確定額ではない。
 */
export type AmountType = 'fixed' | 'variable'

/** その月の金額をどう決めたか。UI に算出根拠を出すために使う */
export type AmountBasis =
  | 'confirmed'  // 実際の取引と照合できた確定額
  | 'planned'    // ユーザーが入力した予定額
  | 'average'    // 直近3ヶ月の確定実績の平均
  | 'unknown'    // 金額を決められない(警告する)

/** 変動固定費の今月の金額と、その根拠 */
export interface ResolvedAmount {
  amount: number
  basis: AmountBasis
  /** average のとき、平均に使った月数 */
  sampleMonths?: number
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
  /** 'variable' なら amount は予定額。実額は確定 > 予定 > 3ヶ月平均 で決める */
  amount_type?: AmountType
  /**
   * カード利用メールの摘要と突合するキーワード。
   * 一致した実取引があるサイクルでは、この固定費の予測を加算しない（二重計上の防止）。
   */
  match_keywords?: string[] | null
  last_paid_month?: string | null // 'YYYY-MM'。直近どの月まで支払い済みか
  scheduled_date?: string
  generated?: boolean
  /**
   * 'card_statement' は、カード会社が確定させた請求額をユーザーが入力したもの。
   * 同じカード・同じ引き落とし日の見込み(source: 'credit_card')を置き換える。
   */
  source?: 'manual' | 'credit_card' | 'monthly_income' | 'gmail_bank' | 'card_statement'
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

/** どのカード設定にも紐づかず、請求見込みから抜け落ちたカード利用 */
export interface UnassignedCardUsage {
  total: number
  count: number
  /** 'YYYY-MM' → 合計額 */
  byMonth: Record<string, number>
}

/** カード1サイクル分。open=true なら締め前で、金額はまだ増える */
export interface CardCycle {
  cardId: string
  cardName: string
  periodStart: string
  periodEnd: string
  paymentDate: string
  /** 利用通知の積み上げによる見込み額 */
  amount: number
  transactionCount: number
  open: boolean
  debitAccountId: string | null
  /**
   * カード会社が確定させた請求額。入力済みならこちらが正で、予測にもこの額が乗る。
   * 締め前(open)のサイクルはカード会社側も未確定なので常に null。
   */
  confirmedAmount: number | null
}

export interface CashflowResponse {
  currentBalance: AccountBalance | null
  projectedDays: DailyBalance[]
  scheduledPayments: ScheduledPayment[]
  generatedPayments: ScheduledPayment[]
  creditCards: CreditCardSetting[]
  profile: CashflowProfile
  unassignedCardUsage?: UnassignedCardUsage
  cardCycles?: CardCycle[]
}
