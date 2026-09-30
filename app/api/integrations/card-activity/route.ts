import type { NextRequest } from 'next/server'
import { requireIntegrationScope } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase'
import { readFailed } from '@/lib/api-errors'
import { resolveMonthParam } from '@/lib/jst'
import { monthEnd, monthStart } from '@/lib/services/budget-loader'
import {
  decodeCardActivityCursor,
  encodeCardActivityCursor,
  minimizeCardActivity,
} from '@/lib/services/card-activity'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export async function GET(request: NextRequest) {
  const result = await requireIntegrationScope(request, 'card-activity:read')
  if ('response' in result) return result.response

  const search = request.nextUrl.searchParams
  const month = resolveMonthParam(search.get('month'))
  const requested = Number(search.get('limit') ?? DEFAULT_LIMIT)
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT
  const cursor = decodeCardActivityCursor(search.get('cursor'))
  if (search.has('cursor') && !cursor) {
    return Response.json({ error: 'Invalid cursor' }, { status: 400 })
  }

  try {
    let query = supabaseAdmin
      .from('transactions')
      .select('id,date,memo,amount,card_issuer,payment_method,category,needs_review')
      .eq('user_id', result.auth.userId)
      .eq('kind', 'expense')
      // issuer が取れなかった古い取込も、構造化された支払方法がカードなら含める
      .or('card_issuer.not.is.null,payment_method.ilike.*カード*,payment_method.ilike.*card*')
      .gte('date', monthStart(month))
      .lte('date', monthEnd(month))
      .order('date', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)

    const transactionId = search.get('transaction_id')
    if (transactionId) query = query.eq('id', transactionId)
    if (cursor) {
      query = query.or(`date.lt.${cursor.date},and(date.eq.${cursor.date},id.lt.${cursor.id})`)
    }

    const { data, error } = await query
    if (error) throw error

    const rows = data ?? []
    const hasMore = rows.length > limit
    const visible = rows.slice(0, limit).map(minimizeCardActivity)
    const last = visible.at(-1)

    return Response.json({
      month,
      items: visible,
      next_cursor: hasMore && last
        ? encodeCardActivityCursor({ date: last.date, id: last.id })
        : null,
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return readFailed('api/integrations/card-activity', error)
  }
}
