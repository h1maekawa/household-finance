import { NextRequest } from 'next/server'
import { resolveIntegrationUserId } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase'
import { loadBudget } from '@/lib/services/budget-loader'
import { computeInvestmentCapacity } from '@/lib/services/investment-capacity'
import { getMergedCategories } from '@/lib/categories'

export const dynamic = 'force-dynamic'

function currentMonthJst(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
}

function todayJst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isCardBill(name: string, memo?: string | null): boolean {
  const text = `${name} ${memo ?? ''}`.toLowerCase()
  return text.includes('カード') || text.includes('card')
}

/**
 * GET /api/integrations/investment-capacity?month=YYYY-MM
 *
 * AI Company（投資部門）向けのサーバー間API。
 * 当月の投資可能額と、その内訳を返す。
 * 認証は x-import-secret ヘッダー（GAS取込と同じ仕組み）。
 */
export async function GET(request: NextRequest) {
  const userId = await resolveIntegrationUserId(request)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const monthParam = request.nextUrl.searchParams.get('month')
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '') ? (monthParam as string) : currentMonthJst()
  const today = todayJst()
  const monthStart = `${month}-01`
  const monthEnd = `${month}-31`

  try {
    const [budgetLoad, balanceRes, scheduledRes, investmentRes, categories] = await Promise.all([
      loadBudget(userId, month, today),
      supabaseAdmin
        .from('account_balance')
        .select('balance, recorded_at')
        .eq('user_id', userId)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('scheduled_payments')
        .select('name, amount, memo, type, is_active, scheduled_date, category')
        .eq('user_id', userId)
        .eq('is_active', true),
      supabaseAdmin
        .from('investment_transactions')
        .select('trade_date, amount, side')
        .eq('user_id', userId)
        .gte('trade_date', monthStart)
        .lte('trade_date', monthEnd),
      getMergedCategories(userId),
    ])

    const budget = budgetLoad.summary
    const missingData: string[] = []

    // 口座残高。未登録なら投資余力は算出できない
    const availableCash = balanceRes.data?.balance ?? null
    if (availableCash === null) missingData.push('口座残高が未登録です')
    if (budget.income.planned === 0) missingData.push('月収の設定がありません')

    // 今月これから入る収入
    const expectedIncome = Math.max(0, budget.income.planned - budget.income.actual)

    // 未引落のカード請求と、それ以外の引落予定を分ける
    const scheduled = scheduledRes.data ?? []
    const fixedNames = new Set(categories.fixedNames)
    let pendingCardAmount = 0
    let scheduledExpenses = 0
    for (const payment of scheduled) {
      const amount = Number(payment.amount) || 0
      if (isCardBill(payment.name, payment.memo)) {
        pendingCardAmount += amount
      } else if (!fixedNames.has(payment.category ?? '')) {
        // 固定費は budget.fixed.unpaid で数えるので、ここでは二重計上しない
        scheduledExpenses += amount
      }
    }

    // 今月すでに投資に回した額（買付のみ）
    const alreadyInvested = (investmentRes.data ?? [])
      .filter(tx => tx.side === 'buy' || tx.side === '買付')
      .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0)

    const capacity = computeInvestmentCapacity({
      month,
      availableCash,
      expectedIncome,
      confirmedIncome: budget.income.actual,
      confirmedExpenses: budget.variable.spent,
      pendingCardAmount,
      fixedExpenses: budget.fixed.unpaid,
      scheduledExpenses,
      livingReserve: Math.max(0, budget.variable.remaining),
      buffer: budget.buffer,
      alreadyInvested,
      missingData,
    })

    return Response.json({
      ...capacity,
      // 家計側の「今月あといくら使えるか」もそのまま渡す
      living: {
        variable_budget: budget.variable.budget,
        spent: budget.variable.spent,
        remaining: budget.variable.remaining,
        days_left: budget.variable.daysLeft,
        daily_allowance: budget.variable.dailyAllowance,
        pace: budget.variable.pace,
      },
      balance_recorded_at: balanceRes.data?.recorded_at ?? null,
      source: budgetLoad.source,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '投資可能額の算出に失敗しました'
    console.error('[investment-capacity] 失敗:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
