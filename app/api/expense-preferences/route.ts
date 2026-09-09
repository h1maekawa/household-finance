import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isValueTag } from '@/lib/services/expense-intelligence'
import { readFailed, writeFailed } from '@/lib/api-errors'

export const dynamic = 'force-dynamic'

/** GET /api/expense-preferences — カテゴリごとの価値タグ */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('expense_preferences')
    .select('category, value_tag')
    .eq('user_id', user.id)

  if (error) return readFailed('api/expense-preferences', error)
  return Response.json({ preferences: data ?? [] })
}

/**
 * PUT /api/expense-preferences — 1カテゴリの価値タグを設定・解除する。
 * value_tag に null を渡すと未設定へ戻す（「まだ決めていない」と
 * 「必須と決めた」は別物なので、行を消して null に戻す）。
 */
export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const body = (await request.json().catch(() => ({}))) as {
    category?: unknown
    value_tag?: unknown
  }

  const category = String(body.category ?? '').trim().slice(0, 40)
  if (!category) {
    return Response.json({ error: 'category は必須です' }, { status: 400 })
  }

  if (body.value_tag === null) {
    const { error } = await supabase
      .from('expense_preferences')
      .delete()
      .eq('user_id', user.id)
      .eq('category', category)
    if (error) return writeFailed('api/expense-preferences', error)
    return Response.json({ category, value_tag: null })
  }

  if (!isValueTag(body.value_tag)) {
    return Response.json({ error: 'value_tag が不正です' }, { status: 400 })
  }

  const { error } = await supabase.from('expense_preferences').upsert(
    {
      user_id: user.id,
      category,
      value_tag: body.value_tag,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,category' }
  )

  if (error) return writeFailed('api/expense-preferences', error)
  return Response.json({ category, value_tag: body.value_tag })
}
