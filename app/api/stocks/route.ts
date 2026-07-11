import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { getStockPrice, getUsdToJpy } from '@/lib/stock'
import { StockHoldingInput, StockWithQuote } from '@/types/stock'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { data: holdings, error } = await supabaseAdmin
    .from('stock_holdings')
    .select('*')
    .eq('user_id', user.id)
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
        const yahooPriceJpy = h.market === 'US' ? Math.round(quote.price * usdJpy) : quote.price
        const yahooCurrentValue = yahooPriceJpy * h.shares
        const costTotal    = h.average_cost * h.shares
        const hasBrokerValue = typeof h.broker_current_value === 'number' && h.broker_current_value > 0
        const currentValue = hasBrokerValue ? Math.round(h.broker_current_value) : yahooCurrentValue
        const gainLoss = typeof h.broker_gain_loss === 'number'
          ? Math.round(h.broker_gain_loss)
          : currentValue - costTotal
        const gainLossRate = typeof h.broker_gain_loss_rate === 'number'
          ? h.broker_gain_loss_rate
          : costTotal > 0 ? gainLoss / costTotal : 0

        return {
          ...h,
          currentPrice:  hasBrokerValue ? h.broker_current_price ?? yahooPriceJpy : yahooPriceJpy,
          currentValue,
          gainLoss,
          gainLossRate,
          valueSource: hasBrokerValue ? 'broker' : 'yahoo',
          yahooCurrentPrice: yahooPriceJpy,
          yahooCurrentValue,
          yahooGainLoss: yahooCurrentValue - costTotal,
          yahooGainLossRate: costTotal > 0 ? (yahooCurrentValue - costTotal) / costTotal : 0,
        }
      } catch (e) {
        const costTotal = h.average_cost * h.shares
        const hasBrokerValue = typeof h.broker_current_value === 'number' && h.broker_current_value > 0
        if (hasBrokerValue) {
          const currentValue = Math.round(h.broker_current_value)
          const gainLoss = typeof h.broker_gain_loss === 'number'
            ? Math.round(h.broker_gain_loss)
            : currentValue - costTotal
          return {
            ...h,
            currentPrice: h.broker_current_price ?? null,
            currentValue,
            gainLoss,
            gainLossRate: typeof h.broker_gain_loss_rate === 'number'
              ? h.broker_gain_loss_rate
              : costTotal > 0 ? gainLoss / costTotal : 0,
            valueSource: 'broker',
            yahooCurrentPrice: null,
            yahooCurrentValue: null,
            yahooGainLoss: null,
            yahooGainLossRate: null,
            error: null,
          }
        }

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
    .eq('user_id', user.id)
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
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body: StockHoldingInput = await request.json()

  const { data, error } = await supabaseAdmin
    .from('stock_holdings')
    .insert([{ ...body, user_id: user.id }])
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
