// app/api/transactions/[id]/route.ts
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { pickAllowed } from '@/lib/patch'
import { TransactionInput } from '@/types/transaction'

type Context = { params: Promise<{ id: string }> }

const PATCHABLE_FIELDS = [
  'date', 'amount', 'category', 'payment_method', 'memo', 'source',
  'kind', 'external_id', 'card_issuer', 'needs_review', 'review_reason',
  'manual_category', 'auto_category',
] as const satisfies readonly (keyof TransactionInput)[]

export async function DELETE(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { id } = await params

  const { error } = await supabaseAdmin
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { id } = await params
  const body: Partial<TransactionInput> = await request.json()
  const patch = pickAllowed<TransactionInput, keyof TransactionInput>(body, PATCHABLE_FIELDS)
  const categoryPatch = body.category !== undefined
    ? { category: body.category, manual_category: body.category }
    : {}

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .update({
      ...patch,
      ...categoryPatch,
      needs_review: body.needs_review ?? false,
      review_reason: body.needs_review ? body.review_reason ?? null : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data)
}
