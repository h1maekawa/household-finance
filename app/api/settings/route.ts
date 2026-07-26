import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type SettingsBody = {
  initial_balance?: number
  monthly_income?: number
  income_day?: number
}

function normalizeAmount(value: unknown) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.round(amount)
}

function normalizeDay(value: unknown) {
  const day = Number(value)
  if (!Number.isFinite(day) || day < 1 || day > 31) return null
  return Math.round(day)
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()
  const supabase = await createSupabaseServerClient()

  const [profileRes, balanceRes] = await Promise.all([
    supabase
      .from('users_profile')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('account_balance')
      .select('*')
      .eq('user_id', user.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (profileRes.error) {
    return Response.json({ error: profileRes.error.message }, { status: 500 })
  }
  if (balanceRes.error) {
    return Response.json({ error: balanceRes.error.message }, { status: 500 })
  }

  return Response.json({
    profile: profileRes.data ?? {
      user_id: user.id,
      initial_balance: balanceRes.data?.balance ?? 0,
      monthly_income: 0,
    },
    currentBalance: balanceRes.data,
  })
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()
  const supabase = await createSupabaseServerClient()

  const body: SettingsBody = await request.json()

  // 部分更新を許す。固定収支ページは月収・給料日だけを、キャッシュフローページは
  // 残高だけを送る。全項目必須にすると、月収を保存するたびに残高スナップショットが
  // 1件積まれて残高の推移が汚れてしまう。
  const patch: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() }

  if (body.initial_balance !== undefined) {
    const initialBalance = normalizeAmount(body.initial_balance)
    if (initialBalance === null) {
      return Response.json({ error: '残高を正しく入力してください' }, { status: 400 })
    }
    patch.initial_balance = initialBalance
  }

  if (body.monthly_income !== undefined) {
    const monthlyIncome = normalizeAmount(body.monthly_income)
    if (monthlyIncome === null) {
      return Response.json({ error: '月収を正しく入力してください' }, { status: 400 })
    }
    patch.monthly_income = monthlyIncome
  }

  if (body.income_day !== undefined) {
    const incomeDay = normalizeDay(body.income_day)
    if (incomeDay === null) {
      return Response.json({ error: '給料日は1〜31で入力してください' }, { status: 400 })
    }
    patch.income_day = incomeDay
  }

  if (Object.keys(patch).length <= 2) {
    return Response.json({ error: '更新する項目がありません' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('users_profile')
    .upsert(patch, { onConflict: 'user_id' })
    .select()
    .single()

  if (profileError) {
    return Response.json({ error: profileError.message }, { status: 500 })
  }

  // 残高スナップショットは、残高が実際に送られてきたときだけ積む
  let balance = null
  if (patch.initial_balance !== undefined) {
    const { data, error: balanceError } = await supabase
      .from('account_balance')
      .insert([{ balance: patch.initial_balance, user_id: user.id }])
      .select()
      .single()

    if (balanceError) {
      return Response.json({ error: balanceError.message }, { status: 500 })
    }
    balance = data
  }

  return Response.json({ profile, currentBalance: balance })
}
