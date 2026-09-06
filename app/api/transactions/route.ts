// app/api/transactions/route.ts
import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { pickAllowed } from '@/lib/patch'
import { TransactionInput } from '@/types/transaction'
import { readFailed, writeFailed } from '@/lib/api-errors'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const { searchParams } = request.nextUrl
  const year = searchParams.get('year') ?? new Date().getFullYear().toString()
  const month = searchParams.get('month') ?? (new Date().getMonth() + 1).toString()
  const explicitStart = searchParams.get('start')
  const explicitEnd = searchParams.get('end')

  const startDate = explicitStart ?? `${year}-${String(month).padStart(2, '0')}-01`
  const endMonth = explicitEnd ?? (parseInt(month) === 12
    ? `${parseInt(year) + 1}-01-01`
    : `${year}-${String(parseInt(month) + 1).padStart(2, '0')}-01`)

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .gte('date', startDate)
    .lt('date', endMonth)
    .order('date', { ascending: false })

  if (error) {
    return readFailed('api/transactions', error)
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
      // 収支。画面側で income - expense を書かせないためAPIで出す
      net: income_total - expense_total,
      by_category,
    },
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const body: Partial<TransactionInput> = await request.json()
  const kind = body.kind === 'income' ? 'income' : 'expense'
  const selectedCategory = String(body.manual_category ?? body.category ?? '').trim()
  const category = selectedCategory || (kind === 'income' ? 'その他収入' : '未分類')

  // マスアサインメント対策: リクエストボディをそのまま insert せず、
  // 許可した入力フィールドだけを抜き出す。id/created_at/updated_at や
  // account_id 等のサーバー管理カラムをクライアントから設定させない。
  const INSERTABLE_FIELDS = [
    'date', 'amount', 'payment_method', 'memo', 'source', 'external_id', 'card_issuer',
  ] as const satisfies readonly (keyof TransactionInput)[]
  const allowed = pickAllowed<TransactionInput, keyof TransactionInput>(body, INSERTABLE_FIELDS)

  const record: Record<string, unknown> = {
    ...allowed,
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
      const res = await supabase.from('transactions').insert([attempt]).select().single()
      if (!res.error) return res
      // 「列が見つからない」系エラー（PGRST204 / 42703）のときだけ、該当列を落として再試行
      const missing = OPTIONAL_COLUMNS.find(
        col => col in attempt && res.error!.message.includes(col)
      )
      if (!missing) return res
      attempt = { ...attempt }
      delete attempt[missing]
    }
    return supabase.from('transactions').insert([attempt]).select().single()
  }

  const { data, error } = await insertResilient()

  if (error) {
    return writeFailed('api/transactions', error)
  }

  return Response.json(data, { status: 201 })
}
