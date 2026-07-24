// lib/services/budget-loader.ts
//
// 予算・コーチ API が共通で使うサーバー側のデータ収集。
// 「収集(I/O)」と「計算(純関数)」を分け、計算は lib/services/*.ts に閉じ込める。
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getMergedCategories } from '@/lib/categories'
import { getBudget, ensureBudget, listBudgetCategories } from '@/lib/repositories/budgets'
import { listAccountsWithBalances } from '@/lib/repositories/accounts'
import { listGoals } from '@/lib/repositories/goals'
import { computeBudget, allocateCategoryBudgets } from './budget-engine'
import { buildUpcomingDebits, type DebitSource } from './upcoming-debits'
import { yen } from './money'
import type {
  BudgetInput,
  BudgetScheduledPayment,
  BudgetSummary,
  BudgetTransaction,
  CategoryBudget,
} from '@/types/budget'

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
  today: string
): Promise<BudgetLoad> {
  const supabase = await createSupabaseServerClient()

  const [{ settings, row, source }, profileRes, scheduledRes, txRes, categories] =
    await Promise.all([
      getBudget(userId, month),
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

/** コーチ用: 引き落とし予定(固定費 + カード請求見込み)を口座付きで組み立てる */
export async function loadUpcomingDebits(userId: string, today: string, horizonDays = 14) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('scheduled_payments')
    .select('id, name, amount, due_day, type, is_active, scheduled_date, debit_account_id')
    .eq('user_id', userId)

  if (error) throw new Error(error.message)

  const sources: DebitSource[] = (data ?? []).map(row => ({
    id: row.id,
    name: row.name,
    amount: yen(row.amount),
    due_day: Number(row.due_day),
    scheduled_date: row.scheduled_date ?? null,
    is_active: row.is_active ?? true,
    type: (row.type ?? 'fixed') as DebitSource['type'],
    debit_account_id: row.debit_account_id ?? null,
  }))

  return buildUpcomingDebits(sources, { today, horizonDays })
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
