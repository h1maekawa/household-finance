import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { FIXED_CATEGORIES } from '@/types/transaction'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { searchParams } = request.nextUrl
  const year  = searchParams.get('year')  ?? new Date().getFullYear().toString()
  const month = searchParams.get('month') ?? (new Date().getMonth() + 1).toString()

  const y = parseInt(year)
  const m = parseInt(month)

  // 今月・先月・3ヶ月前の期間を計算
  function monthRange(yr: number, mo: number) {
    const start = `${yr}-${String(mo).padStart(2, '0')}-01`
    const nextMo = mo === 12 ? `${yr + 1}-01-01` : `${yr}-${String(mo + 1).padStart(2, '0')}-01`
    return { start, end: nextMo }
  }

  function prevMonth(yr: number, mo: number, offset: number) {
    let nm = mo - offset
    let ny = yr
    while (nm <= 0) { nm += 12; ny -= 1 }
    return { yr: ny, mo: nm }
  }

  const current  = monthRange(y, m)
  const prev1    = prevMonth(y, m, 1)
  const prev2    = prevMonth(y, m, 2)
  const prev3    = prevMonth(y, m, 3)

  const ranges = [
    current,
    monthRange(prev1.yr, prev1.mo),
    monthRange(prev2.yr, prev2.mo),
    monthRange(prev3.yr, prev3.mo),
  ]

  const [curRes, p1Res, p2Res, p3Res] = await Promise.all(
    ranges.map(r =>
      supabaseAdmin
        .from('transactions')
        .select('category, amount')
        .eq('user_id', user.id)
        .gte('date', r.start)
        .lt('date', r.end)
    )
  )

  if (curRes.error) return Response.json({ error: curRes.error.message }, { status: 500 })

  const fixedSet = new Set<string>(FIXED_CATEGORIES as unknown as string[])

  function split(rows: { category: string; amount: number }[]) {
    let fixed = 0; let variable = 0
    for (const r of rows) {
      if (fixedSet.has(r.category)) fixed += r.amount
      else variable += r.amount
    }
    return { fixed, variable }
  }

  const cur = split(curRes.data ?? [])
  const p1  = split(p1Res.data  ?? [])
  const p2  = split(p2Res.data  ?? [])
  const p3  = split(p3Res.data  ?? [])

  const avg3Variable = Math.round((p1.variable + p2.variable + p3.variable) / 3)

  const alerts: { type: string; message: string; severity: 'warning' | 'info' }[] = []

  if (p1.fixed > 0 && cur.fixed > p1.fixed * 1.05) {
    const diff = cur.fixed - p1.fixed
    alerts.push({
      type: 'fixed_high',
      message: `今月の固定費が先月比 ${diff.toLocaleString()}円 増加しています`,
      severity: 'warning',
    })
  }

  if (avg3Variable > 0 && cur.variable > avg3Variable * 1.15) {
    const rate = Math.round((cur.variable / avg3Variable - 1) * 100)
    alerts.push({
      type: 'variable_high',
      message: `今月の変動費が過去3ヶ月平均比 ${rate}% 増加しています`,
      severity: 'warning',
    })
  }

  return Response.json({
    fixed:    { total: cur.fixed,    prev_month: p1.fixed,    change_rate: p1.fixed    ? (cur.fixed    - p1.fixed)    / p1.fixed    : 0 },
    variable: { total: cur.variable, prev_month: p1.variable, change_rate: p1.variable ? (cur.variable - p1.variable) / p1.variable : 0 },
    alerts,
  })
}
