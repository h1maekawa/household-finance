import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { describeMissingColumn } from '@/lib/credit-card-errors'
import type { CardType, CardPlan } from '@/lib/card-payment-rules'

const VALID_CARD_TYPES = new Set<CardType>(['rakuten', 'smbc', 'generic'])
const VALID_CARD_PLANS = new Set<CardPlan>([
  'rakuten_standard', 'rakuten_market', 'smbc_10th', 'smbc_26th', 'generic',
])

type CreditCardBody = {
  name?: string
  closing_day_int?: number
  payment_day_int?: number
  payment_month_offset?: number
  card_type?: string
  card_plan?: string
  bank_account?: string | null
  debit_account_id?: string | null
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

function toRow(body: CreditCardBody, userId: string) {
  const name = String(body.name ?? '').trim()
  const closingDay = normalizeDay(body.closing_day_int)
  const paymentDay = normalizeDay(body.payment_day_int)
  const paymentMonthOffset = normalizeOffset(body.payment_month_offset ?? 1)

  if (!name || closingDay === null || paymentDay === null || paymentMonthOffset === null) {
    return null
  }

  const rawType = String(body.card_type ?? '').trim() as CardType
  const rawPlan = String(body.card_plan ?? '').trim() as CardPlan
  const cardType: CardType = VALID_CARD_TYPES.has(rawType) ? rawType : 'generic'
  const cardPlan: CardPlan = VALID_CARD_PLANS.has(rawPlan) ? rawPlan : 'generic'

  return {
    user_id: userId,
    name,
    closing_day: `${closingDay}日`,
    payment_day: paymentMonthOffset === 0 ? `当月${paymentDay}日` : `翌月${paymentDay}日`,
    closing_day_int: closingDay,
    payment_day_int: paymentDay,
    payment_month_offset: paymentMonthOffset,
    card_type: cardType,
    card_plan: cardPlan,
    bank_account: String(body.bank_account ?? '').trim() || null,
    // 引き落とし口座の真実は FK 側。カード払いの固定費をこの口座に付け替える
    debit_account_id: body.debit_account_id || null,
    updated_at: new Date().toISOString(),
  }
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { data, error } = await supabaseAdmin
    .from('credit_cards')
    .select('*')
    .eq('user_id', user.id)
    .order('name', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const row = toRow(await request.json(), user.id)
  if (!row) {
    return Response.json({ error: 'カード名・締め日・引き落とし日を入力してください' }, { status: 400 })
  }

  let { data, error } = await supabaseAdmin
    .from('credit_cards')
    .insert([row])
    .select()
    .single()

  // migration 018 が未適用の環境では debit_account_id 列が無く、PostgREST が
  // insert 全体を弾く。その列だけ落として1回再試行する。
  if (error?.message.includes('debit_account_id')) {
    const fallback = { ...row }
    delete (fallback as Partial<typeof row>).debit_account_id
    ;({ data, error } = await supabaseAdmin
      .from('credit_cards')
      .insert([fallback])
      .select()
      .single())
  }

  if (error) {
    return Response.json(
      { error: describeMissingColumn(error.message) ?? error.message },
      { status: 500 }
    )
  }

  return Response.json(data, { status: 201 })
}
