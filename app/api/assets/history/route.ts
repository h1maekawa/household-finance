import { addDays, addMonths, endOfMonth, format, startOfMonth } from 'date-fns'
import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadAssetSummary } from '@/lib/services/asset-summary-loader'
import { readFailed } from '@/lib/api-errors'

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

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const { searchParams } = request.nextUrl
  const months = Math.min(Math.max(Number(searchParams.get('months') ?? 6), 1), 24)
  const today = new Date()
  const firstMonth = startOfMonth(addMonths(today, -(months - 1)))

  // 現在の残高・保有は loadAssetSummary が読む。ここでは過去の推移を
  // 遡るための取引履歴と、口座残高が未登録なときの初期残高だけを取る
  const [profileRes, transactionsRes, investmentTransactionsRes, summary] = await Promise.all([
    supabase
      .from('users_profile')
      .select('initial_balance')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('transactions')
      .select('date,amount,kind')
      .eq('user_id', user.id)
      .gte('date', format(firstMonth, 'yyyy-MM-dd'))
      .lte('date', format(today, 'yyyy-MM-dd')),
    supabase
      .from('investment_transactions')
      .select('trade_date,trade_type,amount_jpy')
      .eq('user_id', user.id)
      .gte('trade_date', format(firstMonth, 'yyyy-MM-dd'))
      .lte('trade_date', format(today, 'yyyy-MM-dd')),
    loadAssetSummary(user.id, supabase),
  ])

  for (const res of [profileRes, transactionsRes, investmentTransactionsRes]) {
    if (res.error) return readFailed('api/assets/history', res.error)
  }

  const householdTransactions = (transactionsRes.data ?? []) as HouseholdTransaction[]
  const investmentTransactions = (investmentTransactionsRes.data ?? []) as InvestmentTransaction[]
  // 現在値は Home / Assets と同じ asset-summary-loader を正とする。
  // ここで別に集計すると、同じ「総資産」が画面ごとに違う額になる。
  // 過去の推移は当月の実績から遡って計算するので従来どおり。
  const currentCash = summary.liquidCash ?? Number(profileRes.data?.initial_balance ?? 0)
  const currentInvestment = summary.stockValue + summary.fundValue

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
