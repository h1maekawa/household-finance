import { supabaseAdmin } from '@/lib/supabase'
import {
  CATEGORIES,
  INCOME_CATEGORIES,
  FIXED_CATEGORIES,
  Category,
  Kind,
} from '@/types/transaction'

export interface MergedCategories {
  expense: Category[]
  income: Category[]
  /** 固定費として扱うカテゴリ名(既定 + カスタムの is_fixed) */
  fixedNames: string[]
}

interface CustomCategoryRow {
  name: string
  icon: string
  kind: Kind
  is_fixed: boolean
}

/**
 * 既定カテゴリ + ユーザーのカスタムカテゴリをマージして返す。
 * custom_categories テーブルが未作成でも既定カテゴリだけで動作する。
 */
export async function getMergedCategories(userId: string): Promise<MergedCategories> {
  let custom: CustomCategoryRow[] = []
  try {
    const { data, error } = await supabaseAdmin
      .from('custom_categories')
      .select('name, icon, kind, is_fixed')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (!error && data) custom = data as CustomCategoryRow[]
  } catch {
    // テーブル未作成などは既定のみで続行
  }

  const expense: Category[] = [...CATEGORIES]
  const income: Category[] = [...INCOME_CATEGORIES]
  const fixedNames = [...(FIXED_CATEGORIES as readonly string[])]

  for (const row of custom) {
    const list = row.kind === 'income' ? income : expense
    if (!list.some(c => c.name === row.name)) {
      list.push({ name: row.name, icon: row.icon || '📦' })
    }
    if (row.kind === 'expense' && row.is_fixed && !fixedNames.includes(row.name)) {
      fixedNames.push(row.name)
    }
  }

  return { expense, income, fixedNames }
}
