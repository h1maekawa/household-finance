import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getMergedCategories } from '@/lib/categories'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const merged = await getMergedCategories(user.id)
  return Response.json(merged)
}

type AddCategoryBody = {
  name?: string
  icon?: string
  kind?: string
  is_fixed?: boolean
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body: AddCategoryBody = await request.json()
  const name = String(body.name ?? '').trim()
  const icon = String(body.icon ?? '').trim() || '📦'
  const kind = body.kind === 'income' ? 'income' : 'expense'
  const isFixed = Boolean(body.is_fixed)

  if (!name) {
    return Response.json({ error: 'カテゴリ名を入力してください' }, { status: 400 })
  }
  if (name.length > 10) {
    return Response.json({ error: 'カテゴリ名は10文字以内にしてください' }, { status: 400 })
  }

  const merged = await getMergedCategories(user.id)
  const existing = kind === 'income' ? merged.income : merged.expense
  if (existing.some(c => c.name === name)) {
    return Response.json({ error: `「${name}」は既に存在します` }, { status: 409 })
  }

  const { data, error } = await supabaseAdmin
    .from('custom_categories')
    .insert([{ user_id: user.id, name, icon, kind, is_fixed: isFixed }])
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ category: data }, { status: 201 })
}
