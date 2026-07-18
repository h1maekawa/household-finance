// types/transaction.ts

export type Source = 'manual' | 'chat' | 'gmail' | 'receipt'
export type Kind = 'income' | 'expense'

export interface Transaction {
  id: string
  date: string           // YYYY-MM-DD
  amount: number         // 円
  category: string
  payment_method: string
  memo?: string
  source: Source
  kind: Kind
  external_id?: string | null
  card_issuer?: string | null
  needs_review?: boolean
  review_reason?: string | null
  created_at: string
  updated_at: string
}

export interface TransactionInput {
  date: string
  amount: number
  category: string
  payment_method: string
  memo?: string
  source: Source
  kind?: Kind             // 省略時はAPI側で 'expense' として扱う
  external_id?: string    // 外部連携(Gmail取り込みなど)の重複防止キー
  card_issuer?: string | null
  needs_review?: boolean
  review_reason?: string | null
}

export interface TransactionSummary {
  total: number           // 後方互換: expense_total と同じ値
  expense_total: number
  income_total: number
  by_category: Record<string, number>
}

export interface TransactionsResponse {
  transactions: Transaction[]
  summary: TransactionSummary
}

export interface ParsedTransaction {
  date: string           // YYYY-MM-DD
  amount: number
  category: string
  payment_method: string
  memo: string
  confidence: 'high' | 'medium' | 'low'
  kind?: Kind             // 省略時は 'expense' 扱い
}

export interface Category {
  name: string
  icon: string
}

export const CATEGORIES = [
  { name: '食費',      icon: '🍚' },
  { name: '住居費',    icon: '🏠' },
  { name: '交通費',    icon: '🚃' },
  { name: '日用品',    icon: '🧴' },
  { name: '外食',      icon: '🍜' },
  { name: 'カフェ',    icon: '☕' },
  { name: '娯楽',      icon: '🎮' },
  { name: '医療',      icon: '💊' },
  { name: '保険',      icon: '🛡️' },
  { name: '通信費',    icon: '📱' },
  { name: '水道光熱費', icon: '💡' },
  { name: '投資',      icon: '📈' },
  { name: 'その他',    icon: '📦' },
] as const

// 収入用のカテゴリ(支出用のCATEGORIESとは別枠で扱う)
export const INCOME_CATEGORIES = [
  { name: '給与',     icon: '💴' },
  { name: 'その他収入', icon: '💰' },
] as const

export const PAYMENT_METHODS = [
  { name: '現金',      type: 'cash'   },
  { name: '楽天カード', type: 'credit' },
  { name: 'PayPay',    type: 'qr'     },
  { name: 'Suica',     type: 'debit'  },
  { name: '口座振込',   type: 'bank'   },
] as const

// 固定費カテゴリ
export const FIXED_CATEGORIES = ['住居費', '保険', '通信費', '水道光熱費', '投資'] as const
// 変動費カテゴリ
export const VARIABLE_CATEGORIES = ['食費', '交通費', '日用品', '外食', 'カフェ', '娯楽', '医療', 'その他'] as const
