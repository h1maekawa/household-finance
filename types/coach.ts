// types/coach.ts — 日次コーチの入出力契約。
// 洞察は「決定的エンジンが出した構造化データ」。LLM(V2.4)はこれを日本語に整えるだけ。

import type { BudgetSummary, CategoryProgress } from './budget'
import type { GoalProgress } from './goal'

export type InsightType =
  | 'upcoming_debit'
  | 'transfer_suggestion'
  | 'cash_shortfall'
  | 'category_over'
  | 'category_pace_high'
  | 'over_budget'
  | 'pace_high'
  | 'fixed_missing'
  | 'goal_behind'
  | 'goal_milestone'
  | 'progress_on_track'

export type InsightSeverity = 'info' | 'warning' | 'action'

export type InsightAction =
  | { action: 'keep_balance'; account_id: string; account_name: string; amount: number; by: string }
  | { action: 'propose_transfer'; from_account_id: string; from_account_name: string; to_account_id: string; to_account_name: string; amount: number; by: string }
  | { action: 'reduce_category'; category: string; amount: number; times: number }
  | { action: 'review_budget'; month: string; amount: number }
  | { action: 'review_goal'; goal_id: string; required_monthly: number; monthly_pace: number }
  | { action: 'none' }

export type CoachInsight = {
  type: InsightType
  severity: InsightSeverity
  title: string
  body: string
  payload: InsightAction
  /** 同日内の並び順。大きいほど先に見せる */
  priority: number
  generated_for: string // YYYY-MM-DD
}

export type CoachAccount = {
  id: string
  name: string
  balance: number
}

export type UpcomingDebit = {
  date: string // YYYY-MM-DD
  name: string
  amount: number
  accountId: string | null
}

export type CoachContext = {
  today: string // YYYY-MM-DD
  budget: BudgetSummary
  categoryProgress: CategoryProgress[]
  goals: GoalProgress[]
  accounts: CoachAccount[]
  upcomingDebits: UpcomingDebit[]
  /** 引き落とし予告を出す日数(既定 7 = 「来週」) */
  debitHorizonDays?: number
}

export type CoachInsightRow = {
  id: string
  type: InsightType
  severity: InsightSeverity
  title: string
  body: string | null
  payload: InsightAction | null
  status: 'new' | 'seen' | 'dismissed' | 'done'
  generated_for: string
  created_at: string
}
