import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { ensureBudget, upsertBudgetCategories, deleteBudgetCategory } from '@/lib/repositories/budgets'
import { yen } from '@/lib/services/money'
import type { CategoryBudget } from '@/types/budget'

function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
}

/**
 * PUT /api/budget/categories
 * { month, categories: [{ category, amount, source? }] }
 * AI が提案した配分をユーザーが微調整して保存する。source は 'manual' に倒す。
 */
export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  if (!isValidMonth(body.month)) {
    return Response.json({ error: 'month(YYYY-MM)を指定してください' }, { status: 400 })
  }
  if (!Array.isArray(body.categories)) {
    return Response.json({ error: 'categories 配列が必要です' }, { status: 400 })
  }

  const categories: CategoryBudget[] = []
  for (const raw of body.categories as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.category !== 'string' || item.category.length === 0) continue
    const amount = yen(item.amount)
    if (amount < 0) continue
    const source = item.source === 'ai' || item.source === 'template' || item.source === 'history'
      ? item.source
      : 'manual'
    categories.push({ category: item.category, amount, source })
  }

  try {
    const budget = await ensureBudget(user.id, body.month)
    const saved = await upsertBudgetCategories(user.id, budget.id, categories)
    return Response.json({ month: body.month, categoryBudgets: saved })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const month = request.nextUrl.searchParams.get('month')
  const category = request.nextUrl.searchParams.get('category')
  if (!isValidMonth(month) || !category) {
    return Response.json({ error: 'month と category が必要です' }, { status: 400 })
  }

  try {
    const budget = await ensureBudget(user.id, month)
    await deleteBudgetCategory(user.id, budget.id, category)
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
