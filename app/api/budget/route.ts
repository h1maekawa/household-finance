import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { loadBudget } from '@/lib/services/budget-loader'
import { upsertBudget } from '@/lib/repositories/budgets'
import type { BudgetSettings } from '@/types/budget'

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function isValidMonth(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value))
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const monthParam = request.nextUrl.searchParams.get('month')
  const month = isValidMonth(monthParam) ? monthParam : currentMonth()

  try {
    const load = await loadBudget(user.id, month, today())
    return Response.json({
      ...load.summary,
      month,
      source: load.source,
      categoryBudgets: load.categoryBudgets,
    })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

function normalizeOptional(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.round(parsed)
}

function normalizeRequired(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.round(parsed)
}

export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const month = isValidMonth(typeof body.month === 'string' ? body.month : null)
    ? (body.month as string)
    : null // month 省略時はテンプレート行を更新

  const patch: Partial<BudgetSettings> = {}
  const income = normalizeOptional(body.income_planned)
  const fixed = normalizeOptional(body.fixed_planned)
  const override = normalizeOptional(body.variable_budget_override)
  const investment = normalizeRequired(body.investment_target)
  const savings = normalizeRequired(body.savings_target)
  const buffer = normalizeRequired(body.buffer)

  if (income !== undefined) patch.income_planned = income
  if (fixed !== undefined) patch.fixed_planned = fixed
  if (override !== undefined) patch.variable_budget_override = override
  if (investment !== undefined) patch.investment_target = investment
  if (savings !== undefined) patch.savings_target = savings
  if (buffer !== undefined) patch.buffer = buffer

  try {
    const row = await upsertBudget(user.id, month, patch)
    return Response.json(row)
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
