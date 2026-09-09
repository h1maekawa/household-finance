import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { readFailed, writeFailed } from '@/lib/api-errors'

export const dynamic = 'force-dynamic'

/** GET /api/transactions/[id]/items — 取引の内訳 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const { id } = await params

  const { data, error } = await supabase
    .from('transaction_items')
    .select('id, item_name, amount, category, position')
    .eq('transaction_id', id)
    .order('position', { ascending: true })

  if (error) return readFailed('api/transactions/[id]/items', error)
  return Response.json({ items: data ?? [] })
}

/**
 * PUT /api/transactions/[id]/items — 内訳を全置換する。
 *
 * 合計が取引額と一致することの保証はDB側（replace_transaction_items）。
 * ここでは形だけ整えて渡す。画面側の検証はUX用で、最終保証にはしない。
 * 空配列を渡すと分割を解除する。
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const { id } = await params

  const body = (await request.json().catch(() => ({}))) as { items?: unknown }
  if (!Array.isArray(body.items)) {
    return Response.json({ error: 'items は配列で指定してください' }, { status: 400 })
  }

  const items = body.items.map(raw => {
    const item = (raw ?? {}) as Record<string, unknown>
    return {
      item_name: String(item.item_name ?? '').slice(0, 100),
      amount: Math.round(Number(item.amount) || 0),
      category: String(item.category ?? '').slice(0, 40),
    }
  })

  if (items.some(item => item.amount <= 0)) {
    return Response.json({ error: '金額は1円以上で入力してください' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('replace_transaction_items', {
    p_transaction_id: id,
    p_items: items,
  })

  if (error) {
    // 合計不一致・他人の取引はDBが弾く。理由は伝えるが内部の詳細は出さない
    const message = error.message.includes('must equal transaction amount')
      ? '内訳の合計が取引金額と一致していません'
      : error.message.includes('transaction not found')
        ? '対象の取引が見つかりません'
        : null
    if (message) return Response.json({ error: message }, { status: 400 })
    return writeFailed('api/transactions/[id]/items', error)
  }

  return Response.json(data)
}
