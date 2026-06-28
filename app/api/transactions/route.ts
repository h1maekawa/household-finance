// app/api/transactions/route.ts
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { TransactionInput } from '@/types/transaction'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const year = searchParams.get('year') ?? new Date().getFullYear().toString()
  const month = searchParams.get('month') ?? (new Date().getMonth() + 1).toString()

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endMonth = parseInt(month) === 12
    ? `${parseInt(year) + 1}-01-01`
    : `${year}-${String(parseInt(month) + 1).padStart(2, '0')}-01`

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .gte('date', startDate)
    .lt('date', endMonth)
    .order('date', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // サマリ計算
  const transactions = data ?? []
  const total = transactions.reduce((sum, t) => sum + t.amount, 0)
  const by_category: Record<string, number> = {}
  for (const t of transactions) {
    by_category[t.category] = (by_category[t.category] ?? 0) + t.amount
  }

  return Response.json({
    transactions,
    summary: { total, by_category },
  })
}

export async function POST(request: NextRequest) {
  const body: TransactionInput = await request.json()

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .insert([body])
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}
