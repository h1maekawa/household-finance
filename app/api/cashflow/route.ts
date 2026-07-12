import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import {
  buildGeneratedCreditPayments,
  getCashflowFetchEnd,
  getCashflowFetchStart,
  projectCashflow,
} from '@/lib/cashflow'
import { CreditCardSetting, ScheduledPayment } from '@/types/cashflow'
import { Transaction } from '@/types/transaction'

function normalizeName(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[（）()]/g, '')
}

function isBankCardDebit(payment: ScheduledPayment) {
  const text = normalizeName(`${payment.name} ${payment.memo ?? ''}`)
  return payment.source === 'gmail_bank' &&
    Boolean(payment.scheduled_date) &&
    (text.includes('カード') || text.includes('card'))
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const projectionDays = 90
  const [balanceRes, paymentsRes, profileRes, cardsRes, transactionsRes] = await Promise.all([
    supabaseAdmin
      .from('account_balance')
      .select('*')
      .eq('user_id', user.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('scheduled_payments')
      .select('*')
      .eq('user_id', user.id)
      .order('due_day', { ascending: true }),
    supabaseAdmin
      .from('users_profile')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('user_id', user.id)
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', getCashflowFetchStart())
      .lte('date', getCashflowFetchEnd(projectionDays)),
  ])

  if (balanceRes.error) {
    return Response.json({ error: balanceRes.error.message }, { status: 500 })
  }
  if (paymentsRes.error) {
    return Response.json({ error: paymentsRes.error.message }, { status: 500 })
  }
  if (profileRes.error) {
    return Response.json({ error: profileRes.error.message }, { status: 500 })
  }
  if (cardsRes.error) {
    return Response.json({ error: cardsRes.error.message }, { status: 500 })
  }
  if (transactionsRes.error) {
    return Response.json({ error: transactionsRes.error.message }, { status: 500 })
  }

  const scheduledPayments: ScheduledPayment[] = paymentsRes.data ?? []
  const creditCards: CreditCardSetting[] = cardsRes.data ?? []
  const transactions: Transaction[] = transactionsRes.data ?? []
  const bankCardDebitDates = new Set(
    scheduledPayments
      .filter(isBankCardDebit)
      .map(payment => payment.scheduled_date)
      .filter(Boolean)
  )
  const generatedPayments = buildGeneratedCreditPayments(transactions, creditCards, projectionDays)
    .filter(payment => !bankCardDebitDates.has(payment.scheduled_date))
  const profile = profileRes.data ?? {
    initial_balance: balanceRes.data?.balance ?? 0,
    monthly_income: 0,
    income_day: 25,
  }
  const currentBalance = balanceRes.data?.balance ?? 0
  const projectedDays = projectCashflow(
    currentBalance,
    [...scheduledPayments, ...generatedPayments],
    projectionDays,
    {
      monthlyIncome: profile.monthly_income ?? 0,
      incomeDay: profile.income_day ?? 25,
    }
  )

  return Response.json({
    currentBalance: balanceRes.data,
    projectedDays,
    scheduledPayments,
    generatedPayments,
    creditCards,
    profile,
  })
}
