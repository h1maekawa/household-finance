// lib/services/budget-loader.ts
//
// 予算・コーチ API が共通で使うサーバー側のデータ収集。
// 「収集(I/O)」と「計算(純関数)」を分け、計算は lib/services/*.ts に閉じ込める。
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/** Cookieセッション版と service role 版のどちらも受けられるようにする */
type SupabaseLike = SupabaseClient
import { getMergedCategories } from '@/lib/categories'
import { getBudget, ensureBudget, listBudgetCategories } from '@/lib/repositories/budgets'
import { listAccountsWithBalances } from '@/lib/repositories/accounts'
import { listGoals } from '@/lib/repositories/goals'
import { computeBudget, allocateCategoryBudgets } from './budget-engine'
import { loadFxRates } from '@/lib/repositories/fx-rates'
import { buildUpcomingDebits } from './upcoming-debits'
import { toDebitSources } from './fixed-costs'
import { yen } from './money'
import type {
  BudgetInput,
  BudgetScheduledPayment,
  BudgetSummary,
  BudgetTransaction,
  CategoryBudget,
} from '@/types/budget'
import type { CreditCardSetting, ScheduledPayment } from '@/types/cashflow'

export function monthStart(month: string): string {
  return `${month}-01`
}

export function monthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(year, monthNumber, 0).getDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}

/** N ヶ月前の 'YYYY-MM-01' */
function monthsAgoStart(month: string, back: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const zeroBased = year * 12 + (monthNumber - 1) - back
  return `${Math.floor(zeroBased / 12)}-${String((zeroBased % 12) + 1).padStart(2, '0')}-01`
}

export type BudgetLoad = {
  summary: BudgetSummary
  input: BudgetInput
  categoryBudgets: CategoryBudget[]
  categoryBudgetMap: Record<string, number>
  budgetId: string | null
  source: 'month' | 'template' | 'default'
}

/**
 * 指定月の予算サマリと、その入力(コーチが再利用する)をまとめて返す。
 * カテゴリ別サブ枠が未保存なら、過去3ヶ月の実績から機械的に配分した提案を返す(保存はしない)。
 */
export async function loadBudget(
  userId: string,
  month: string,
  today: string,
  /** サーバー間連携ではセッションが無いため supabaseAdmin を渡す */
  client?: SupabaseLike
): Promise<BudgetLoad> {
  const supabase = client ?? (await createSupabaseServerClient())

  const [{ settings, row, source }, profileRes, scheduledRes, txRes, categories] =
    await Promise.all([
      getBudget(userId, month, client),
      supabase.from('users_profile').select('monthly_income').eq('user_id', userId).maybeSingle(),
      supabase
        .from('scheduled_payments')
        .select('id, name, amount, due_day, category, type, is_active')
        .eq('user_id', userId),
      supabase
        .from('transactions')
        .select('id, date, amount, category, kind, memo, payment_method, scheduled_payment_id')
        .eq('user_id', userId)
        .gte('date', monthsAgoStart(month, 3))
        .lte('date', monthEnd(month)),
      getMergedCategories(userId),
    ])

  if (profileRes.error) throw new Error(profileRes.error.message)
  if (scheduledRes.error) throw new Error(scheduledRes.error.message)
  if (txRes.error) throw new Error(txRes.error.message)

  const scheduledPayments: BudgetScheduledPayment[] = (scheduledRes.data ?? []).map(row => ({
    id: row.id,
    name: row.name,
    amount: yen(row.amount),
    due_day: Number(row.due_day),
    category: row.category,
    type: (row.type ?? 'fixed') as BudgetScheduledPayment['type'],
    is_active: row.is_active ?? true,
  }))

  const allTransactions: BudgetTransaction[] = (txRes.data ?? []).map(row => ({
    id: row.id,
    date: row.date,
    amount: yen(row.amount),
    category: row.category,
    kind: (row.kind ?? 'expense') as BudgetTransaction['kind'],
    memo: row.memo,
    payment_method: row.payment_method,
    scheduled_payment_id: row.scheduled_payment_id ?? null,
  }))
  const monthTransactions = allTransactions.filter(tx => tx.date.slice(0, 7) === month)

  const input: BudgetInput = {
    month,
    today,
    settings,
    fixedNames: categories.fixedNames,
    scheduledPayments,
    transactions: monthTransactions,
    fallbackIncome: yen(profileRes.data?.monthly_income ?? 0),
  }
  const summary = computeBudget(input)

  // カテゴリ別サブ枠: 保存済みがあればそれ、無ければ実績ベースの提案を作る。
  let categoryBudgets: CategoryBudget[] = []
  const budgetId = source === 'month' && row ? row.id : null
  if (budgetId) {
    categoryBudgets = await listBudgetCategories(userId, budgetId)
  }
  if (categoryBudgets.length === 0) {
    // 過去3ヶ月の変動費実績の比率で配分する(固定費・クレカ請求・未分類は除外)。
    const historyTotals: Record<string, number> = {}
    for (const tx of allTransactions) {
      if (tx.kind !== 'expense') continue
      if (tx.scheduled_payment_id) continue
      if (categories.fixedNames.includes(tx.category)) continue
      if (['クレカ請求', '未分類'].includes(tx.category)) continue
      historyTotals[tx.category] = (historyTotals[tx.category] ?? 0) + tx.amount
    }
    categoryBudgets = allocateCategoryBudgets(summary.variable.budget, historyTotals)
  }

  const categoryBudgetMap = Object.fromEntries(
    categoryBudgets.map(item => [item.category, item.amount])
  )

  return {
    summary,
    input,
    categoryBudgets,
    categoryBudgetMap,
    budgetId,
    source,
  }
}

/**
 * コーチ用: 引き落とし予定(固定費 + カード請求見込み)を口座付きで組み立てる。
 *
 * 日付・金額・口座の解決は lib/services/fixed-costs.ts の純関数に委譲する。
 * ここを通すことで、営業日補正・契約期間・外貨換算・カード払いの付け替えが
 * コーチのコメントにもそのまま効く。
 */
export async function loadUpcomingDebits(userId: string, today: string, horizonDays = 14) {
  const supabase = await createSupabaseServerClient()

  const [paymentsResult, cardsResult, fx] = await Promise.all([
    supabase
      .from('scheduled_payments')
      .select(
        'id, name, amount, due_day, category, type, is_active, memo, scheduled_date, ' +
        'debit_account_id, payment_method, credit_card_id, start_date, end_date, ' +
        'recurrence, business_day_rule, currency, foreign_amount, created_at'
      )
      .eq('user_id', userId),
    supabase
      .from('credit_cards')
      .select('id, name, closing_day, payment_day, closing_day_int, payment_day_int, ' +
        'payment_month_offset, card_plan, debit_account_id, created_at')
      .eq('user_id', userId),
    loadFxRates(),
  ])

  if (paymentsResult.error) throw new Error(paymentsResult.error.message)

  const payments = (paymentsResult.data ?? []) as unknown as ScheduledPayment[]
  // credit_cards の取得失敗はコーチ全体を落とすほどではない(カード払いの付け替えが効かなくなるだけ)
  const cards = (cardsResult.error ? [] : cardsResult.data ?? []) as unknown as CreditCardSetting[]

  return buildUpcomingDebits(toDebitSources(payments, cards, today, fx), { today, horizonDays })
}

export async function loadCoachInputs(userId: string, month: string, today: string) {
  const [budget, accounts, goals, upcomingDebits] = await Promise.all([
    loadBudget(userId, month, today),
    listAccountsWithBalances(userId),
    listGoals(userId),
    loadUpcomingDebits(userId, today, 14),
  ])

  return {
    budget,
    accounts: accounts.map(a => ({ id: a.id, name: a.name, balance: a.balance })),
    goals,
    upcomingDebits,
  }
}

// helper re-export
export function ensureBudgetRow(userId: string, month: string) {
  return ensureBudget(userId, month)
}
