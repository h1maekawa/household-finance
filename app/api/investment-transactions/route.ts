import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { InvestmentTransactionInput } from '@/types/investment-transaction'

type Body = {
  transactions?: InvestmentTransactionInput[]
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { searchParams } = request.nextUrl
  const limit = Number(searchParams.get('limit') ?? 100)

  const { data, error } = await supabaseAdmin
    .from('investment_transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('trade_date', { ascending: false })
    .limit(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 300) : 100)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ transactions: data ?? [] })
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body: Body = await request.json()
  const transactions = body.transactions ?? []

  if (transactions.length === 0) {
    return Response.json({ inserted: 0, updated: 0, skipped: 0 })
  }

  const rows = transactions.map(tx => ({ ...tx, user_id: user.id }))
  const { data, error } = await supabaseAdmin
    .from('investment_transactions')
    .upsert(rows, { onConflict: 'user_id,external_id' })
    .select('id')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ upserted: data?.length ?? 0 })
}
