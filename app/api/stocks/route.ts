import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getStockPrice, getUsdToJpy } from '@/lib/stock'
import { StockHoldingInput, StockWithQuote } from '@/types/stock'

export async function GET() {
  const { data: holdings, error } = await supabaseAdmin
    .from('stock_holdings')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!holdings || holdings.length === 0) {
    return Response.json({ holdings: [], accountBalance: 0, stockValue: 0, totalAssets: 0 })
  }

  const usdJpy = await getUsdToJpy()

  const withQuotes: StockWithQuote[] = await Promise.all(
    holdings.map(async h => {
      try {
        const quote = await getStockPrice(h.ticker, h.market)
        const priceJpy = h.market === 'US' ? Math.round(quote.price * usdJpy) : quote.price
        const currentValue = priceJpy * h.shares
        const costTotal    = h.average_cost * h.shares
        return {
          ...h,
          currentPrice:  priceJpy,
          currentValue,
          gainLoss:      currentValue - costTotal,
          gainLossRate:  costTotal > 0 ? (currentValue - costTotal) / costTotal : 0,
        }
      } catch (e) {
        return {
          ...h,
          currentPrice: null,
          currentValue: null,
          gainLoss:     null,
          gainLossRate: null,
          error: e instanceof Error ? e.message : '取得失敗',
        }
      }
    })
  )

  const balanceRes = await supabaseAdmin
    .from('account_balance')
    .select('balance')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const accountBalance = balanceRes.data?.balance ?? 0
  const stockValue = withQuotes.reduce((s, h) => s + (h.currentValue ?? 0), 0)

  return Response.json({
    holdings: withQuotes,
    accountBalance,
    stockValue,
    totalAssets: accountBalance + stockValue,
  })
}

export async function POST(request: NextRequest) {
  const body: StockHoldingInput = await request.json()

  const { data, error } = await supabaseAdmin
    .from('stock_holdings')
    .insert([body])
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
