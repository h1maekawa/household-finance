// app/api/debts/[id]/route.ts
import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { pickAllowed } from '@/lib/patch'
import { DebtInput } from '@/types/debt'
import { writeFailed } from '@/lib/api-errors'

type Context = { params: Promise<{ id: string }> }

const PATCHABLE_FIELDS = [
  'direction', 'counterparty', 'amount', 'date', 'due_date', 'memo', 'is_settled',
] as const satisfies readonly (keyof DebtInput)[]

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const { id } = await params
  const body: Partial<DebtInput> = await request.json()
  const patch = pickAllowed<DebtInput, keyof DebtInput>(body, PATCHABLE_FIELDS)

  const { data, error } = await supabase
    .from('debts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return writeFailed('api/debts/[id]', error)
  }

  return Response.json(data)
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const { id } = await params

  const { error } = await supabase
    .from('debts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return writeFailed('api/debts/[id]', error)
  }

  return Response.json({ success: true })
}
