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
  const kind = body.kind ?? 'expense'
  const selectedCategory = String(body.manual_category ?? body.category ?? '').trim()
  const category = selectedCategory || (kind === 'income' ? 'その他収入' : '未分類')

  const record: Record<string, unknown> = {
    ...body,
    kind,
    category,
    manual_category: selectedCategory || null,
    user_id: user.id,
  }

  // マイグレーション017（manual_category/auto_category 列の追加）が
  // まだSupabaseに適用されていない環境でも保存できるようにする。
  // 未知の列でPostgRESTが弾いた場合は、その列を落として1回だけ再挿入する。
  const OPTIONAL_COLUMNS = ['manual_category', 'auto_category']
  async function insertResilient() {
    let attempt = { ...record }
    for (let i = 0; i <= OPTIONAL_COLUMNS.length; i++) {
      const res = await supabaseAdmin.from('transactions').insert([attempt]).select().single()
      if (!res.error) return res
      // 「列が見つからない」系エラー（PGRST204 / 42703）のときだけ、該当列を落として再試行
      const missing = OPTIONAL_COLUMNS.find(
        col => col in attempt && res.error!.message.includes(col)
      )
      if (!missing) return res
      attempt = { ...attempt }
      delete attempt[missing]
    }
    return supabaseAdmin.from('transactions').insert([attempt]).select().single()
  }

  const { data, error } = await insertResilient()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}
