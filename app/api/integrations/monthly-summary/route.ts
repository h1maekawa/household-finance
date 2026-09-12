import { NextRequest } from 'next/server'
import { resolveIntegrationUserId } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase'
import { loadBudget, monthEnd, monthStart } from '@/lib/services/budget-loader'
import { getMergedCategories } from '@/lib/categories'

export const dynamic = 'force-dynamic'

/** 要確認は「件数」が主役。明細は多すぎても意味がないので上限を切る */
const NEEDS_REVIEW_LIMIT = 50

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

type ReviewItem = {
  id: string
  date: string
  amount: number
  category: string
  memo: string | null
  reason: string | null
}

/**
 * 要確認の取引。マイグレーション004（needs_review列）が未適用の環境でも
 * 500にせず、supported:false で縮退させる。
 */
async function loadNeedsReview(
  userId: string,
  month: string
): Promise<{ count: number; items: ReviewItem[]; supported: boolean }> {
  try {
    const { data, count, error } = await supabaseAdmin
      .from('transactions')
      .select('id, date, amount, category, memo, review_reason', { count: 'exact' })
      .eq('user_id', userId)
      .eq('kind', 'expense')
      .eq('needs_review', true)
      .gte('date', monthStart(month))
      .lte('date', monthEnd(month))
      .order('date', { ascending: true })
      .limit(NEEDS_REVIEW_LIMIT)

    if (error) return { count: 0, items: [], supported: false }

    const items: ReviewItem[] = (data ?? []).map(row => ({
      id: String(row.id),
      date: String(row.date).slice(0, 10),
      amount: Math.abs(Number(row.amount) || 0),
      category: String(row.category ?? ''),
      memo: row.memo ?? null,
      reason: row.review_reason ?? null,
    }))
    return { count: count ?? items.length, items, supported: true }
  } catch {
    return { count: 0, items: [], supported: false }
  }
}

/**
 * GET /api/integrations/monthly-summary?month=YYYY-MM
 *
 * AI Company（家計）向けのサーバー間API。
 * 当月の家計サマリを「集計済みの数字」で返す。生取引は返さない。
 *
 * 分類の正はこのアプリ側にある（merchant_rules / manual_category /
 * needs_review / 固定費カテゴリ）。AI Company は再分類せず、この結果を
 * 表示・通知・目標接続に使う。要確認の修正もこのアプリのUIで行う。
 *
 * 認証は x-import-secret ヘッダー（GAS取込・investment-capacity と同じ仕組み）。
 */
export async function GET(request: NextRequest) {
  const userId = await resolveIntegrationUserId(request)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const monthParam = request.nextUrl.searchParams.get('month')
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '') ? (monthParam as string) : currentMonthJst()
  const today = todayJst()

  try {
    const [budgetLoad, categories, review] = await Promise.all([
      loadBudget(userId, month, today, supabaseAdmin),
      getMergedCategories(userId),
      loadNeedsReview(userId, month),
    ])

    const budget = budgetLoad.summary
    const stats = budget.variable.categoryStats

    // 変動費のカテゴリ内訳。固定費は名前(支払先)単位なので fixed.items 側に分ける
    const byCategory = Object.entries(budget.variable.byCategory)
      .map(([category, amount]) => ({
        category,
        amount,
        count: stats[category]?.count ?? 0,
        average: stats[category]?.average ?? 0,
      }))
      .sort((a, b) => b.amount - a.amount)

    return Response.json({
      month,
      generated_at: new Date().toISOString(),
      currency: 'JPY',
      source: budgetLoad.source,
      app_url: `${request.nextUrl.origin}/transactions`,

      income: budget.income,
      fixed: {
        planned: budget.fixed.planned,
        paid: budget.fixed.paid,
        unpaid: budget.fixed.unpaid,
        effective: budget.fixed.effective,
        items: budget.fixed.items.map(item => ({
          name: item.name,
          planned: item.planned,
          actual: item.actual,
          status: item.status,
        })),
      },
      variable: {
        budget: budget.variable.budget,
        spent: budget.variable.spent,
        remaining: budget.variable.remaining,
        days_in_month: budget.variable.daysInMonth,
        days_elapsed: budget.variable.daysElapsed,
        days_left: budget.variable.daysLeft,
        daily_allowance: budget.variable.dailyAllowance,
        pace: budget.variable.pace,
      },
      // 固定費(確定分)＋変動費。「今月いくら使ったか」の1つの数字
      total_spent: budget.fixed.effective + budget.variable.spent,
      buffer: budget.buffer,
      savings_target: budget.savings.target,
      investment_target: budget.investment.target,

      by_category: byCategory,
      fixed_category_names: categories.fixedNames,
      needs_review: review,
      alerts: budget.alerts,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '家計サマリの取得に失敗しました'
    console.error('[monthly-summary] 失敗:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
