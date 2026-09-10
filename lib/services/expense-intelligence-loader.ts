// lib/services/expense-intelligence-loader.ts
//
// 支出分析の収集(I/O)。計算は expense-intelligence.ts の純関数に閉じ込める。
//
// カテゴリ別の集計は「取引の内訳があればそちらを、無ければ取引そのものを」
// 数える。分割した取引を親カテゴリでも数えると二重計上になる。
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getMergedCategories } from '@/lib/categories'
import { listBudgetCategories, getBudget } from '@/lib/repositories/budgets'
import { monthEnd, monthStart } from './budget-loader'
import {
  analyzeExpenses,
  isValueTag,
  tallyByCategory,
  type CategoryExpense,
  type ItemRow,
  type TxRow,
  type ValueTag,
} from './expense-intelligence'

/** YYYY-MM から n ヶ月前の月キー */
function monthsAgo(month: string, back: number): string {
  const [year, m] = month.split('-').map(Number)
  const zero = year * 12 + (m - 1) - back
  return `${Math.floor(zero / 12)}-${String((zero % 12) + 1).padStart(2, '0')}`
}

export type ExpenseIntelligenceLoad = {
  month: string
  categories: CategoryExpense[]
}

export async function loadExpenseIntelligence(
  userId: string,
  month: string,
  client?: SupabaseClient
): Promise<ExpenseIntelligenceLoad> {
  const supabase = client ?? (await createSupabaseServerClient())
  const previous = monthsAgo(month, 1)
  const threeMonthsStart = monthStart(monthsAgo(month, 3))

  const [currentRes, previousRes, threeRes, itemsRes, prefsRes, categories, budget] =
    await Promise.all([
      supabase
        .from('transactions')
        .select('id, date, amount, category, kind')
        .eq('user_id', userId)
        .gte('date', monthStart(month))
        .lte('date', monthEnd(month)),
      supabase
        .from('transactions')
        .select('id, date, amount, category, kind')
        .eq('user_id', userId)
        .gte('date', monthStart(previous))
        .lte('date', monthEnd(previous)),
      supabase
        .from('transactions')
        .select('id, date, amount, category, kind')
        .eq('user_id', userId)
        .gte('date', threeMonthsStart)
        .lt('date', monthStart(month)),
      supabase
        .from('transaction_items')
        .select('transaction_id, amount, category')
        .eq('user_id', userId),
      supabase.from('expense_preferences').select('category, value_tag').eq('user_id', userId),
      getMergedCategories(userId, client),
      getBudget(userId, month, client),
    ])

  // 取得失敗を「0円」として分析に流さない
  for (const [label, res] of [
    ['transactions(当月)', currentRes],
    ['transactions(先月)', previousRes],
    ['transactions(3ヶ月)', threeRes],
    ['transaction_items', itemsRes],
    ['expense_preferences', prefsRes],
  ] as const) {
    if (res.error) throw new Error(`${label} の取得に失敗しました: ${res.error.message}`)
  }

  const items = (itemsRes.data ?? []) as ItemRow[]
  const current = tallyByCategory((currentRes.data ?? []) as TxRow[], items)
  const prev = tallyByCategory((previousRes.data ?? []) as TxRow[], items)
  const three = tallyByCategory((threeRes.data ?? []) as TxRow[], items)

  const valueTags: Record<string, ValueTag> = {}
  for (const row of prefsRes.data ?? []) {
    if (isValueTag(row.value_tag)) valueTags[row.category as string] = row.value_tag
  }

  const budgets: Record<string, number> = {}
  if (budget.row?.id) {
    for (const item of await listBudgetCategories(userId, budget.row.id, client)) {
      budgets[item.category] = item.amount
    }
  }

  return {
    month,
    categories: analyzeExpenses({
      currentMonth: current.totals,
      previousMonth: prev.totals,
      threeMonthTotal: three.totals,
      transactionCount: current.counts,
      budgets,
      valueTags,
      fixedCategories: categories.fixedNames,
    }),
  }
}
