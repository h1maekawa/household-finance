import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'

type Context = { params: Promise<{ id: string }> }

type CreditCardBody = {
  name?: string
  closing_day_int?: number
  payment_day_int?: number
  payment_month_offset?: number
}

function normalizeDay(value: unknown) {
  const day = Number(value)
  if (!Number.isFinite(day) || day < 1 || day > 31) return null
  return Math.round(day)
}

function normalizeOffset(value: unknown) {
  const offset = Number(value)
  if (!Number.isFinite(offset) || offset < 0 || offset > 2) return null
  return Math.round(offset)
}

function toPatch(body: CreditCardBody) {
  const name = String(body.name ?? '').trim()
  const closingDay = normalizeDay(body.closing_day_int)
  const paymentDay = normalizeDay(body.payment_day_int)
  const paymentMonthOffset = normalizeOffset(body.payment_month_offset ?? 1)

  if (!name || closingDay === null || paymentDay === null || paymentMonthOffset === null) {
    return null
  }

  return {
    name,
    closing_day: `${closingDay}日`,
    payment_day: paymentMonthOffset === 0 ? `当月${paymentDay}日` : `翌月${paymentDay}日`,
    closing_day_int: closingDay,
    payment_day_int: paymentDay,
    payment_month_offset: paymentMonthOffset,
    updated_at: new Date().toISOString(),
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { id } = await params
  const patch = toPatch(await request.json())
  if (!patch) {
    return Response.json({ error: 'カード名・締め日・引き落とし日を入力してください' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('credit_cards')
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
    .from('credit_cards')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
