// app/api/debts/route.ts
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { DebtInput } from '@/types/debt'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const includeSettled = request.nextUrl.searchParams.get('include') === 'all'

  let query = supabaseAdmin
    .from('debts')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  if (!includeSettled) {
    query = query.eq('is_settled', false)
  }

  const { data, error } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body: DebtInput = await request.json()

  if (!body.direction || !body.counterparty || !body.amount) {
    return Response.json({ error: 'direction, counterparty, amount は必須です' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('debts')
    .insert([{ ...body, is_settled: body.is_settled ?? false, user_id: user.id }])
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}
