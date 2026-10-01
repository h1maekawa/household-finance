import type { NextRequest } from 'next/server'
import { getMergedCategories } from '@/lib/categories'
import { readFailed, writeFailed } from '@/lib/api-errors'
import { requireIntegrationScope } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveMonthParam } from '@/lib/jst'
import { monthEnd, monthStart } from '@/lib/services/budget-loader'

export const dynamic = 'force-dynamic'

/** AI Company 向け。確認待ちの支出だけを、分類に必要な最小項目で返す。 */
export async function GET(request: NextRequest) {
  const result = await requireIntegrationScope(request, 'transactions:categorize')
  if ('response' in result) return result.response

  const month = resolveMonthParam(request.nextUrl.searchParams.get('month'))
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 20), 1), 50)
  if (!Number.isInteger(limit)) return Response.json({ error: 'Invalid limit' }, { status: 400 })

  try {
    const [transactions, categories] = await Promise.all([
      supabaseAdmin
        .from('transactions')
        .select('id,date,amount,memo,payment_method,card_issuer,auto_category,review_reason')
        .eq('user_id', result.auth.userId)
        .eq('kind', 'expense')
        .eq('needs_review', true)
        .gte('date', monthStart(month))
        .lte('date', monthEnd(month))
        .order('date', { ascending: false })
        .limit(limit),
      getMergedCategories(result.auth.userId, supabaseAdmin),
    ])
    if (transactions.error) return readFailed('api/integrations/transaction-reviews', transactions.error)
    return Response.json({
      month,
      items: transactions.data ?? [],
      categories: categories.expense.filter((category) => category.name !== '未分類'),
    })
  } catch (error) {
    return readFailed('api/integrations/transaction-reviews', error)
  }
}

/** 金額などは変更せず、指定取引のカテゴリ確定だけを行う。 */
export async function PATCH(request: NextRequest) {
  const result = await requireIntegrationScope(request, 'transactions:categorize')
  if ('response' in result) return result.response

  const body = await request.json().catch(() => null) as { id?: unknown; category?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const category = typeof body?.category === 'string' ? body.category.trim() : ''
  if (!id || !category) return Response.json({ error: '取引とカテゴリを選択してください' }, { status: 400 })

  const categories = await getMergedCategories(result.auth.userId, supabaseAdmin)
  if (category === '未分類' || !categories.expense.some((item) => item.name === category)) {
    return Response.json({ error: '利用できないカテゴリです' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .update({ category, manual_category: category, needs_review: false, review_reason: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', result.auth.userId)
    .eq('kind', 'expense')
    .eq('needs_review', true)
    .select('id,date,amount,category')
    .maybeSingle()

  if (error) return writeFailed('api/integrations/transaction-reviews', error)
  if (!data) return Response.json({ error: '確認待ちの取引が見つかりません' }, { status: 404 })
  return Response.json({ transaction: data })
}
