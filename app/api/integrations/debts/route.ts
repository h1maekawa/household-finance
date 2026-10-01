import type { NextRequest } from 'next/server'
import { readFailed } from '@/lib/api-errors'
import { requireIntegrationScope } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type DebtItem = {
  id: string
  direction: 'borrowed' | 'lent'
  counterparty: string
  amount: number
  date: string
  due_date: string | null
  memo: string | null
  is_settled: boolean
}

export async function GET(request: NextRequest) {
  const result = await requireIntegrationScope(request, 'assets:read')
  if ('response' in result) return result.response

  const includeSettled = request.nextUrl.searchParams.get('include') === 'all'

  try {
    const data: Record<string, unknown>[] = []
    let cursor: string | undefined
    for (;;) {
    let query = supabaseAdmin
      .from('debts')
      .select('id,direction,counterparty,amount,date,due_date,memo,is_settled')
      .eq('user_id', result.auth.userId)
      .order('id', { ascending: true })
      .limit(500)

    if (!includeSettled) query = query.eq('is_settled', false)
    if (cursor) query = query.gt('id', cursor)

    const { data: page, error } = await query

    if (error) throw error
    if (!page?.length) break
    const next = page.at(-1)!.id as string
    if (!next || next === cursor || data.length + page.length > 10_000) throw new Error('DEBT_RESULT_LIMIT')
    data.push(...page)
    cursor = next
    }

    const items: DebtItem[] = (data ?? []).map((debt) => ({
      id: debt.id as string,
      direction: debt.direction as DebtItem['direction'],
      counterparty: debt.counterparty as string,
      amount: typeof debt.amount === 'number' ? debt.amount : Number.NaN,
      date: debt.date as string,
      due_date: (debt.due_date ?? null) as string | null,
      memo: (debt.memo ?? null) as string | null,
      is_settled: debt.is_settled as boolean,
    }))
    const ids = new Set<string>()
    for (const item of items) {
      if (!Number.isFinite(item.amount) || item.amount < 0 || !['borrowed', 'lent'].includes(item.direction) || ids.has(item.id)) throw new Error('INVALID_DEBT')
      ids.add(item.id)
    }
    items.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))

    const totals = items.reduce(
      (sum, debt) => {
        sum[debt.direction] += debt.amount
        return sum
      },
      { borrowed: 0, lent: 0 }
    )
    if (!Number.isFinite(totals.borrowed) || !Number.isFinite(totals.lent)) throw new Error('INVALID_TOTAL')

    return Response.json(
      { items, totals },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    return readFailed('api/integrations/debts', error)
  }
}
