import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getMergedCategories } from '@/lib/categories'
import { readFailed, writeFailed } from '@/lib/api-errors'

type RuleBody = {
  merchant_pattern?: string
  category?: string
  payment_method?: string | null
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

async function isValidCategory(supabase: ServerClient, userId: string, category: string) {
  const merged = await getMergedCategories(userId, supabase)
  return [...merged.expense, ...merged.income].some(c => c.name === category)
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('merchant_rules')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return readFailed('api/category-rules', error)
  }

  return Response.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const body: RuleBody = await request.json()
  const merchantPattern = String(body.merchant_pattern ?? '').trim()
  const category = String(body.category ?? '').trim()

  if (!merchantPattern || !(await isValidCategory(supabase, user.id, category))) {
    return Response.json({ error: '分類したい文字とカテゴリを選んでください' }, { status: 400 })
  }

  const { data, error } = await supabase
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
    return writeFailed('api/category-rules', error)
  }

  return Response.json(data, { status: 201 })
}
