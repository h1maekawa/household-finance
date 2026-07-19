import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getMergedCategories } from '@/lib/categories'

type RuleBody = {
  merchant_pattern?: string
  category?: string
  payment_method?: string | null
}

async function isValidCategory(userId: string, category: string) {
  const merged = await getMergedCategories(userId)
  return [...merged.expense, ...merged.income].some(c => c.name === category)
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { data, error } = await supabaseAdmin
    .from('merchant_rules')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body: RuleBody = await request.json()
  const merchantPattern = String(body.merchant_pattern ?? '').trim()
  const category = String(body.category ?? '').trim()

  if (!merchantPattern || !(await isValidCategory(user.id, category))) {
    return Response.json({ error: '分類したい文字とカテゴリを選んでください' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('merchant_rules')
    .insert([{
      user_id: user.id,
      merchant_pattern: merchantPattern,
      category,
      payment_method: body.payment_method || null,
      confidence: 1,
    }])
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}
