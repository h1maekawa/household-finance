import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { writeFailed } from '@/lib/api-errors'

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const { balance } = await request.json()

  if (typeof balance !== 'number' || balance < 0) {
    return Response.json({ error: '残高は0以上の数値を指定してください' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('account_balance')
    .insert([{ balance, user_id: user.id }])
    .select()
    .single()

  if (error) {
    return writeFailed('api/cashflow/balance', error)
  }

  return Response.json(data, { status: 201 })
}
