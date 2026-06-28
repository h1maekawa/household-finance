import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ScheduledPaymentInput } from '@/types/cashflow'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Context) {
  const { id } = await params
  const body: Partial<ScheduledPaymentInput> = await request.json()

  const { data, error } = await supabaseAdmin
    .from('scheduled_payments')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data)
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  const { id } = await params

  const { error } = await supabaseAdmin
    .from('scheduled_payments')
    .delete()
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
