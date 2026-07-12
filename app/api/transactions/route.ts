// app/api/transactions/route.ts
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { TransactionInput } from '@/types/transaction'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { searchParams } = request.nextUrl
  const year = searchParams.get('year') ?? new Date().getFullYear().toString()
  const month = searchParams.get('month') ?? (new Date().getMonth() + 1).toString()
  const explicitStart = searchParams.get('start')
  const explicitEnd = searchParams.get('end')

  const startDate = explicitStart ?? `${year}-${String(month).padStart(2, '0')}-01`
  const endMonth = explicitEnd ?? (parseInt(month) === 12
    ? `${parseInt(year) + 1}-01-01`
    : `${year}-${String(parseInt(month) + 1).padStart(2, '0')}-01`)

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .gte('date', startDate)
    .lt('date', endMonth)
    .order('date', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // サマリ計算(収入は支出の集計・カテゴリ内訳には含めない)
  const transactions = data ?? []
  const expenseTx = transactions.filter(t => t.kind !== 'income')
  const incomeTx = transactions.filter(t => t.kind === 'income')

  const expense_total = expenseTx.reduce((sum, t) => sum + t.amount, 0)
  const income_total = incomeTx.reduce((sum, t) => sum + t.amount, 0)
  const by_category: Record<string, number> = {}
  for (const t of expenseTx) {
    by_category[t.category] = (by_category[t.category] ?? 0) + t.amount
  }

  return Response.json({
    transactions,
    summary: {
      total: expense_total, // 後方互換: 既存UIは「今月の支出」としてこの値を使う
      expense_total,
      income_total,
      by_category,
    },
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body: TransactionInput = await request.json()

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .insert([{ ...body, kind: body.kind ?? 'expense', user_id: user.id }])
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}
