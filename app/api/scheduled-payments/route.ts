import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ScheduledPaymentInput } from '@/types/cashflow'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('scheduled_payments')
    .select('*')
    .order('due_day', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const body: ScheduledPaymentInput = await request.json()

  const { data, error } = await supabaseAdmin
    .from('scheduled_payments')
    .insert([{ ...body, is_active: body.is_active ?? true }])
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}
