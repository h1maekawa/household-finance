// app/api/transactions/[id]/route.ts
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { TransactionInput } from '@/types/transaction'

type Context = { params: Promise<{ id: string }> }

export async function DELETE(_request: NextRequest, { params }: Context) {
  const { id } = await params

  const { error } = await supabaseAdmin
    .from('transactions')
    .delete()
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const { id } = await params
  const body: Partial<TransactionInput> = await request.json()

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data)
}
