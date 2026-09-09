import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { requireActiveEntitlement } from '@/lib/entitlements'
import { InvestmentTransactionInput } from '@/types/investment-transaction'
import { readFailed, writeFailed } from '@/lib/api-errors'

type Body = {
  transactions?: InvestmentTransactionInput[]
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  if (!await requireActiveEntitlement(user.id)) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const { searchParams } = request.nextUrl
  const limit = Number(searchParams.get('limit') ?? 100)

  const { data, error } = await supabase
    .from('investment_transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('trade_date', { ascending: false })
    .limit(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 300) : 100)

  if (error) return readFailed('api/investment-transactions', error)
  return Response.json({ transactions: data ?? [] })
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  if (!await requireActiveEntitlement(user.id)) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const body: Body = await request.json()
  const transactions = body.transactions ?? []

  if (transactions.length === 0) {
    return Response.json({ inserted: 0, updated: 0, skipped: 0 })
  }

  const rows = transactions.map(tx => ({ ...tx, user_id: user.id }))
  const { data, error } = await supabase
    .from('investment_transactions')
    .upsert(rows, { onConflict: 'user_id,external_id' })
    .select('id')

  if (error) return writeFailed('api/investment-transactions', error)
  return Response.json({ upserted: data?.length ?? 0 })
}
