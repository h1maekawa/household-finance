import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { pickAllowed } from '@/lib/patch'
import { ScheduledPaymentInput } from '@/types/cashflow'

type Context = { params: Promise<{ id: string }> }

const PATCHABLE_FIELDS = [
  'name', 'amount', 'due_day', 'category', 'type', 'is_active', 'memo',
  'bank_account', 'last_paid_month', 'scheduled_date', 'external_id',
] as const satisfies readonly (keyof ScheduledPaymentInput)[]

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { id } = await params
  const body: Partial<ScheduledPaymentInput> = await request.json()
  const patch = pickAllowed<ScheduledPaymentInput, keyof ScheduledPaymentInput>(body, PATCHABLE_FIELDS)

  const { data, error } = await supabaseAdmin
    .from('scheduled_payments')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data)
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { id } = await params

  const { error } = await supabaseAdmin
    .from('scheduled_payments')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
