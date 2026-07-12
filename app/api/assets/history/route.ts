import { addDays, addMonths, endOfMonth, format, startOfMonth } from 'date-fns'
import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

type HouseholdTransaction = {
  date: string
  amount: number
  kind: 'income' | 'expense'
}

type InvestmentTransaction = {
  trade_date: string
  trade_type: string
  amount_jpy: number
}

function signedInvestmentAmount(tx: InvestmentTransaction) {
  const tradeType = String(tx.trade_type ?? '').toLowerCase()
  const rawAmount = Number(tx.amount_jpy ?? 0)
  const amount = Math.abs(rawAmount)

  if (/売|sell|解約|換金|償還/.test(tradeType)) return -amount
  if (/買|buy|購入|積立|再投資/.test(tradeType)) return amount
  return rawAmount
}

function stockCurrentValue(holding: {
  broker_current_value?: number | null
  shares?: number | null
  average_cost?: number | null
}) {
  const brokerValue = Number(holding.broker_current_value ?? 0)
  if (brokerValue > 0) return brokerValue
  return Number(holding.shares ?? 0) * Number(holding.average_cost ?? 0)
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { searchParams } = request.nextUrl
  const months = Math.min(Math.max(Number(searchParams.get('months') ?? 6), 1), 24)
  const today = new Date()
  const firstMonth = startOfMonth(addMonths(today, -(months - 1)))

  const [
    balanceRes,
    profileRes,
    transactionsRes,
    investmentTransactionsRes,
    stocksRes,
    fundsRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('account_balance')
      .select('balance')
      .eq('user_id', user.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('users_profile')
      .select('initial_balance')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabaseAdmin
      .from('transactions')
      .select('date,amount,kind')
      .eq('user_id', user.id)
      .gte('date', format(firstMonth, 'yyyy-MM-dd'))
      .lte('date', format(today, 'yyyy-MM-dd')),
    supabaseAdmin
      .from('investment_transactions')
      .select('trade_date,trade_type,amount_jpy')
      .eq('user_id', user.id)
      .gte('trade_date', format(firstMonth, 'yyyy-MM-dd'))
      .lte('trade_date', format(today, 'yyyy-MM-dd')),
    supabaseAdmin
      .from('stock_holdings')
      .select('broker_current_value,shares,average_cost')
      .eq('user_id', user.id),
    supabaseAdmin
      .from('fund_holdings')
      .select('current_value')
      .eq('user_id', user.id),
  ])

  for (const res of [balanceRes, profileRes, transactionsRes, investmentTransactionsRes, stocksRes, fundsRes]) {
    if (res.error) return Response.json({ error: res.error.message }, { status: 500 })
  }

  const householdTransactions = (transactionsRes.data ?? []) as HouseholdTransaction[]
  const investmentTransactions = (investmentTransactionsRes.data ?? []) as InvestmentTransaction[]
  const currentCash = Number(balanceRes.data?.balance ?? profileRes.data?.initial_balance ?? 0)
  const currentInvestment =
    (stocksRes.data ?? []).reduce((sum, holding) => sum + stockCurrentValue(holding), 0) +
    (fundsRes.data ?? []).reduce((sum, fund) => sum + Number(fund.current_value ?? 0), 0)

  const points = Array.from({ length: months }).map((_, index) => {
    const monthDate = addMonths(firstMonth, index)
    const rawMonthEnd = endOfMonth(monthDate)
    const monthEnd = rawMonthEnd > today ? today : rawMonthEnd
    const nextDay = addDays(monthEnd, 1)
    const nextDayKey = format(nextDay, 'yyyy-MM-dd')

    const laterHouseholdNet = householdTransactions
      .filter(tx => tx.date >= nextDayKey)
      .reduce((sum, tx) => sum + (tx.kind === 'income' ? Number(tx.amount) : -Number(tx.amount)), 0)
    const laterInvestmentNet = investmentTransactions
      .filter(tx => tx.trade_date >= nextDayKey)
      .reduce((sum, tx) => sum + signedInvestmentAmount(tx), 0)

    const cash = Math.max(Math.round(currentCash - laterHouseholdNet), 0)
    const investment = Math.max(Math.round(currentInvestment - laterInvestmentNet), 0)

    return {
      label: format(monthDate, 'M月'),
      month: format(monthDate, 'yyyy-MM'),
      cash,
      investment,
      total: cash + investment,
    }
  })

  return Response.json({
    points,
    current: {
      cash: Math.round(currentCash),
      investment: Math.round(currentInvestment),
      total: Math.round(currentCash + currentInvestment),
    },
  })
}
