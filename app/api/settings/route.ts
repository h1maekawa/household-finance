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
  const initialBalance = normalizeAmount(body.initial_balance)
  const monthlyIncome = normalizeAmount(body.monthly_income)
  const incomeDay = normalizeDay(body.income_day ?? 25)

  if (initialBalance === null || monthlyIncome === null || incomeDay === null) {
    return Response.json({ error: '残高・月収・給料日を正しく入力してください' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('users_profile')
    .upsert({
      user_id: user.id,
      initial_balance: initialBalance,
      monthly_income: monthlyIncome,
      income_day: incomeDay,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single()

  if (profileError) {
    return Response.json({ error: profileError.message }, { status: 500 })
  }

  const { data: balance, error: balanceError } = await supabase
    .from('account_balance')
    .insert([{ balance: initialBalance, user_id: user.id }])
    .select()
    .single()

  if (balanceError) {
    return Response.json({ error: balanceError.message }, { status: 500 })
  }

  return Response.json({ profile, currentBalance: balance })
}
