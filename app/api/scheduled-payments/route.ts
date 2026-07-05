import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { ScheduledPaymentInput } from '@/types/cashflow'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { data, error } = await supabaseAdmin
    .from('scheduled_payments')
    .select('*')
    .eq('user_id', user.id)
    .order('due_day', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body: ScheduledPaymentInput = await request.json()

  const { data, error } = await supabaseAdmin
    .from('scheduled_payments')
    .insert([{ ...body, is_active: body.is_active ?? true, user_id: user.id }])
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}
