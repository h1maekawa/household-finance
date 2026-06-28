// types/transaction.ts

export type Source = 'manual' | 'chat' | 'gmail' | 'receipt'

export interface Transaction {
  id: string
  date: string           // YYYY-MM-DD
  amount: number         // 円
  category: string
  payment_method: string
  memo?: string
  source: Source
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
}

export interface TransactionSummary {
  total: number
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
}

export const CATEGORIES = [
  { name: '食費',      icon: '🍚' },
  { name: '交通費',    icon: '🚃' },
  { name: '日用品',    icon: '🧴' },
  { name: '外食',      icon: '🍜' },
  { name: '娯楽',      icon: '🎮' },
  { name: '医療',      icon: '💊' },
  { name: '通信費',    icon: '📱' },
  { name: '水道光熱費', icon: '💡' },
  { name: 'その他',    icon: '📦' },
] as const

export const PAYMENT_METHODS = [
  { name: '現金',      type: 'cash'   },
  { name: '楽天カード', type: 'credit' },
  { name: 'PayPay',    type: 'qr'     },
  { name: 'Suica',     type: 'debit'  },
] as const

// 固定費カテゴリ
export const FIXED_CATEGORIES = ['通信費', '水道光熱費'] as const
// 変動費カテゴリ
export const VARIABLE_CATEGORIES = ['食費', '交通費', '日用品', '外食', '娯楽', '医療', 'その他'] as const
