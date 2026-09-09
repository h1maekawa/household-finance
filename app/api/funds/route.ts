import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { requireActiveEntitlement } from '@/lib/entitlements'
import { FundHoldingInput } from '@/types/fund'
import { readFailed, writeFailed } from '@/lib/api-errors'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  if (!await requireActiveEntitlement(user.id)) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const { data, error } = await supabase
    .from('fund_holdings')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) return readFailed('api/funds', error)
  return Response.json({ funds: data ?? [] })
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  if (!await requireActiveEntitlement(user.id)) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const body: FundHoldingInput = await request.json()

  const { data, error } = await supabase
    .from('fund_holdings')
    .insert([{ ...body, user_id: user.id }])
    .select()
    .single()

  if (error) return writeFailed('api/funds', error)
  return Response.json(data, { status: 201 })
}
