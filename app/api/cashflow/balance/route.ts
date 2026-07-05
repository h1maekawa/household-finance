import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { balance } = await request.json()

  if (typeof balance !== 'number' || balance < 0) {
    return Response.json({ error: '残高は0以上の数値を指定してください' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('account_balance')
    .insert([{ balance, user_id: user.id }])
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}
