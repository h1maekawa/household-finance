// lib/repositories/budgets.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/** Cookieセッション版と service role 版のどちらも受けられるようにする */
type SupabaseLike = SupabaseClient
import { yen } from '@/lib/services/money'
import type { BudgetSettings, CategoryBudget } from '@/types/budget'

export type BudgetRow = {
  id: string
  month: string | null
} & BudgetSettings

const DEFAULT_SETTINGS: BudgetSettings = {
  income_planned: null,
  fixed_planned: null,
  investment_target: 0,
  savings_target: 0,
  buffer: 0,
  variable_budget_override: null,
}

function toSettings(row: Record<string, unknown> | null): BudgetSettings {
  if (!row) return { ...DEFAULT_SETTINGS }
  const optional = (value: unknown) =>
    value === null || value === undefined ? null : yen(value)
  return {
    income_planned: optional(row.income_planned),
    fixed_planned: optional(row.fixed_planned),
    investment_target: yen(row.investment_target),
    savings_target: yen(row.savings_target),
    buffer: yen(row.buffer),
    variable_budget_override: optional(row.variable_budget_override),
  }
}

/**
 * その月の行 → month is null のテンプレート行 → 既定値 の順でフォールバックする
 * (docs/budget-design.md)。
 */
export async function getBudget(
  userId: string,
  month: string,
  /**
   * 読み取りに使うクライアント。既定はCookieセッション版。
   * サーバー間連携（セッションが無い経路）では supabaseAdmin を渡す。
   */
  client?: SupabaseLike
): Promise<{ row: BudgetRow | null; settings: BudgetSettings; source: 'month' | 'template' | 'default' }> {
  const supabase = client ?? (await createSupabaseServerClient())
  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId)
    .or(`month.eq.${month},month.is.null`)

  if (error) throw new Error(error.message)

  const rows = data ?? []
  const monthly = rows.find(row => row.month === month) ?? null
  const template = rows.find(row => row.month === null) ?? null
  const effective = monthly ?? template

  return {
    row: effective ? ({ id: effective.id, month: effective.month, ...toSettings(effective) }) : null,
    settings: toSettings(effective),
    source: monthly ? 'month' : template ? 'template' : 'default',
  }
}

export async function upsertBudget(
  userId: string,
  month: string | null,
  patch: Partial<BudgetSettings>
): Promise<BudgetRow> {
  const supabase = await createSupabaseServerClient()
  const current = month ? (await getBudget(userId, month)).settings : { ...DEFAULT_SETTINGS }
  const merged: BudgetSettings = { ...current, ...patch }

  const { data, error } = await supabase
    .from('budgets')
    .upsert(
      {
        user_id: userId,
        month,
        ...merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,month' }
    )
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return { id: data.id, month: data.month, ...toSettings(data) }
}

/** 予算行が無ければ作る(カテゴリ枠は budget_id を必要とするため) */
export async function ensureBudget(userId: string, month: string): Promise<BudgetRow> {
  const existing = await getBudget(userId, month)
  if (existing.row && existing.source === 'month') return existing.row
  // テンプレートがあればその値を引き継いで当月行を作る
  return upsertBudget(userId, month, existing.settings)
}

export async function listBudgetCategories(
  userId: string,
  budgetId: string
): Promise<CategoryBudget[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('budget_categories')
    .select('category, amount, source')
    .eq('user_id', userId)
    .eq('budget_id', budgetId)
    .order('amount', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map(row => ({
    category: row.category,
    amount: yen(row.amount),
    source: row.source as CategoryBudget['source'],
  }))
}

export async function upsertBudgetCategories(
  userId: string,
  budgetId: string,
  categories: CategoryBudget[]
): Promise<CategoryBudget[]> {
  if (categories.length === 0) return []
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('budget_categories').upsert(
    categories.map(item => ({
      user_id: userId,
      budget_id: budgetId,
      category: item.category,
      amount: yen(item.amount),
      source: item.source,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'budget_id,category' }
  )

  if (error) throw new Error(error.message)
  return listBudgetCategories(userId, budgetId)
}

export async function deleteBudgetCategory(
  userId: string,
  budgetId: string,
  category: string
): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('budget_categories')
    .delete()
    .eq('user_id', userId)
    .eq('budget_id', budgetId)
    .eq('category', category)

  if (error) throw new Error(error.message)
}
