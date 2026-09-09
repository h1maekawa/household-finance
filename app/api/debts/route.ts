// app/api/debts/route.ts
import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { DebtInput } from '@/types/debt'
import { readFailed, writeFailed } from '@/lib/api-errors'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const includeSettled = request.nextUrl.searchParams.get('include') === 'all'

  let query = supabase
    .from('debts')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  if (!includeSettled) {
    query = query.eq('is_settled', false)
  }

  const { data, error } = await query

  if (error) {
    return readFailed('api/debts', error)
  }

  return Response.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const body: DebtInput = await request.json()

  if (!body.direction || !body.counterparty || !body.amount) {
    return Response.json({ error: 'direction, counterparty, amount は必須です' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('debts')
    .insert([{ ...body, is_settled: body.is_settled ?? false, user_id: user.id }])
    .select()
    .single()

  if (error) {
    return writeFailed('api/debts', error)
  }

  return Response.json(data, { status: 201 })
}
