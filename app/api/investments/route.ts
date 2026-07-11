// app/api/investments/route.ts
//
// ダッシュボードの「資産合計」「本日の投資損益」ティーザーカード用。
// 以前はサンプルデータ(lib/investments.ts)を返すだけだったが、
// 実際のstock_holdingsとYahoo Financeのライブ価格から計算するようにした。
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { getStockPrice, getUsdToJpy } from '@/lib/stock'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const [holdingsRes, fundsRes] = await Promise.all([
    supabaseAdmin
      .from('stock_holdings')
      .select('*')
      .eq('user_id', user.id),
    supabaseAdmin
      .from('fund_holdings')
      .select('current_value')
      .eq('user_id', user.id),
  ])

  if (holdingsRes.error) {
    return Response.json({ error: holdingsRes.error.message }, { status: 500 })
  }
  if (fundsRes.error) {
    return Response.json({ error: fundsRes.error.message }, { status: 500 })
  }

  const holdings = holdingsRes.data ?? []
  const fundValue = (fundsRes.data ?? []).reduce((sum, fund) => sum + Number(fund.current_value ?? 0), 0)

  if (!holdings || holdings.length === 0) {
    return Response.json({
      summary: { investmentValue: fundValue, dayPnl: 0, unreadHighImportanceNews: 0 },
      updatedAt: new Date().toISOString(),
    })
  }

  const usdJpy = await getUsdToJpy()

  let investmentValue = fundValue
  let dayPnl = 0

  await Promise.all(
    holdings.map(async h => {
      if (typeof h.broker_current_value === 'number' && h.broker_current_value > 0) {
        investmentValue += Math.round(h.broker_current_value)
        return
      }

      try {
        const quote = await getStockPrice(h.ticker, h.market)
        const fx = h.market === 'US' ? usdJpy : 1
        investmentValue += Math.round(quote.price * fx) * h.shares
        dayPnl += Math.round(quote.change * fx) * h.shares
      } catch {
        // 個別銘柄の取得失敗は無視して他の銘柄の集計を続ける
      }
    })
  )

  return Response.json({
    summary: {
      investmentValue,
      dayPnl,
      // ニュース連携は未実装のため常に0(サンプルデータ時代の見せかけの数値は出さない)
      unreadHighImportanceNews: 0,
    },
    updatedAt: new Date().toISOString(),
  })
}
