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

  try {
    const { data, error } = await supabaseAdmin
      .from('debts')
      .select('id,direction,counterparty,amount,date,due_date,memo,is_settled')
      .eq('user_id', result.auth.userId)
      .order('date', { ascending: false })

    if (error) throw error

    const items: DebtItem[] = (data ?? []).map((debt) => ({
      id: debt.id,
      direction: debt.direction,
      counterparty: debt.counterparty,
      amount: Number(debt.amount) || 0,
      date: debt.date,
      due_date: debt.due_date ?? null,
      memo: debt.memo ?? null,
      is_settled: debt.is_settled,
    }))

    const totals = items.reduce(
      (sum, debt) => {
        sum[debt.direction] += debt.amount
        return sum
      },
      { borrowed: 0, lent: 0 }
    )

    return Response.json(
      { items, totals },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    return readFailed('api/integrations/debts', error)
  }
}
