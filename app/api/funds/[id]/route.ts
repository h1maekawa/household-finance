import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { requireActiveEntitlement } from '@/lib/entitlements'
import { pickAllowed } from '@/lib/patch'
import { FundHoldingInput } from '@/types/fund'
import { writeFailed } from '@/lib/api-errors'

type Context = { params: Promise<{ id: string }> }

const PATCHABLE_FIELDS = [
  'name', 'account_type', 'units', 'average_cost', 'base_price',
  'current_value', 'gain_loss', 'gain_loss_rate', 'broker_snapshot_at',
] as const satisfies readonly (keyof FundHoldingInput)[]

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  if (!await requireActiveEntitlement(user.id)) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const { id } = await params
  const body: Partial<FundHoldingInput> = await request.json()
  const patch = pickAllowed<FundHoldingInput, keyof FundHoldingInput>(body, PATCHABLE_FIELDS)

  const { data, error } = await supabase
    .from('fund_holdings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return writeFailed('api/funds/[id]', error)
  return Response.json(data)
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  if (!await requireActiveEntitlement(user.id)) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const { id } = await params

  const { error } = await supabase
    .from('fund_holdings')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return writeFailed('api/funds/[id]', error)
  return Response.json({ success: true })
}
