import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { FundHoldingInput } from '@/types/fund'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { id } = await params
  const body: Partial<FundHoldingInput> = await request.json()

  const { data, error } = await supabaseAdmin
    .from('fund_holdings')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { id } = await params

  const { error } = await supabaseAdmin
    .from('fund_holdings')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
