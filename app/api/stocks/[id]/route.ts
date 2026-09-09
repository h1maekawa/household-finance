import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { requireActiveEntitlement } from '@/lib/entitlements'
import { pickAllowed } from '@/lib/patch'
import { StockHoldingInput } from '@/types/stock'
import { writeFailed } from '@/lib/api-errors'

type Context = { params: Promise<{ id: string }> }

const PATCHABLE_FIELDS = [
  'ticker', 'name', 'market', 'shares', 'average_cost',
  'broker_current_value', 'broker_gain_loss', 'broker_gain_loss_rate',
  'broker_current_price', 'broker_price_currency', 'broker_fx_rate', 'broker_snapshot_at',
] as const satisfies readonly (keyof StockHoldingInput)[]

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  if (!await requireActiveEntitlement(user.id)) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const { id } = await params
  const body: Partial<StockHoldingInput> = await request.json()
  const patch = pickAllowed<StockHoldingInput, keyof StockHoldingInput>(body, PATCHABLE_FIELDS)

  const { data, error } = await supabase
    .from('stock_holdings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return writeFailed('api/stocks/[id]', error)
  return Response.json(data)
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  if (!await requireActiveEntitlement(user.id)) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const { id } = await params

  const { error } = await supabase
    .from('stock_holdings')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return writeFailed('api/stocks/[id]', error)
  return Response.json({ success: true })
}
