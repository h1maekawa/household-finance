// types/budget.ts — 予算エンジンの入出力契約。
// API のレスポンス型でもあるので、Web/native が同じ計算結果を消費できる形に保つ。

export type BudgetSettings = {
  /** null なら users_profile.monthly_income にフォールバック */
  income_planned: number | null
  /** null なら scheduled_payments(type='fixed') の合計から算出 */
  fixed_planned: number | null
  investment_target: number
  savings_target: number
  buffer: number
  /** 手入力で変動費枠を直接指定する場合 */
  variable_budget_override: number | null
}

export type BudgetTransaction = {
  id: string
  date: string // YYYY-MM-DD
  amount: number
  category: string
  kind: 'income' | 'expense'
  memo?: string | null
  payment_method?: string | null
  scheduled_payment_id?: string | null
}

export type BudgetScheduledPayment = {
  id: string
  name: string
  amount: number
  due_day: number
  category: string
  type: 'fixed' | 'credit' | 'income'
  is_active: boolean
}

export type FixedItemStatus = 'paid' | 'over' | 'under' | 'unpaid' | 'missing'

export type FixedItem = {
  id: string
  name: string
  due_day: number
  planned: number
  actual: number | null
  status: FixedItemStatus
  matched_transaction_id: string | null
  /** 枠の計算に使う額(実績があれば実額、無ければ予定額) */
  effective: number
}

export type CategoryStat = {
  total: number
  count: number
  /** 1回あたりの平均額。「外食を1回減らせば戻せる」の係数に使う */
  average: number
}

export type BudgetAlertType =
  | 'pace_high'
  | 'over_budget'
  | 'fixed_missing'
  | 'income_missing'

export type BudgetAlert = {
  type: BudgetAlertType
  severity: 'info' | 'warning' | 'action'
  message: string
}

export type BudgetSummary = {
  month: string
  income: { planned: number; actual: number }
  fixed: {
    planned: number
    paid: number
    unpaid: number
    effective: number
    items: FixedItem[]
  }
  investment: { target: number }
  savings: { target: number }
  buffer: number
  variable: {
    budget: number
    spent: number
    remaining: number
    daysInMonth: number
    daysElapsed: number
    daysLeft: number
    dailyAllowance: number
    /** 1.0 超で使いすぎ傾向 */
    pace: number
    byCategory: Record<string, number>
    categoryStats: Record<string, CategoryStat>
  }
  alerts: BudgetAlert[]
}

export type BudgetInput = {
  month: string // YYYY-MM
  /** 純関数化のため「今日」は必ず外から渡す */
  today: string // YYYY-MM-DD
  settings: BudgetSettings
  /** 固定費として扱うカテゴリ名(既定 + カスタム) */
  fixedNames: string[]
  scheduledPayments: BudgetScheduledPayment[]
  /** 当月の取引(利用日ベース) */
  transactions: BudgetTransaction[]
  /** users_profile.monthly_income のフォールバック */
  fallbackIncome?: number
}

export type CategoryBudget = {
  category: string
  amount: number
  source: 'ai' | 'manual' | 'template' | 'history'
}

export type CategoryProgress = {
  category: string
  budget: number
  spent: number
  remaining: number
  /** 消化率(0〜) */
  rate: number
  /** 経過日数比に対するペース。1.0 超で使いすぎ */
  pace: number
  average: number
  count: number
}
