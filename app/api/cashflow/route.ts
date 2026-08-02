import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import {
  buildCardCycles,
  buildGeneratedCreditPayments,
  findUnassignedCardUsage,
  indexConfirmedStatements,
  getCashflowFetchEnd,
  getCashflowFetchStart,
  projectCashflow,
} from '@/lib/cashflow'
import { loadFxRates } from '@/lib/repositories/fx-rates'
import {
  findUnmatchedCardFixedCosts,
  matchFixedCostsToCardUsage,
  suppressedByConfirmedCycles,
  suppressedDebitKeys,
} from '@/lib/services/fixed-cost-matching'
import { addMonths as addMonthKey } from '@/lib/services/fixed-costs'
import type { CreditCardSetting, ScheduledPayment } from '@/types/cashflow'
import type { Transaction } from '@/types/transaction'

function normalizeName(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[（）()]/g, '')
}

function isConfirmedCardDebit(payment: ScheduledPayment) {
  const text = normalizeName(`${payment.name} ${payment.memo ?? ''}`)
  return payment.source === 'gmail_bank' &&
    Boolean(payment.scheduled_date) &&
    (text.includes('カード') || text.includes('card') || text.includes('三井住友') || text.includes('楽天'))
}

function confirmedPaymentMatchesGenerated(confirmed: ScheduledPayment, generated: ScheduledPayment) {
  if (!isConfirmedCardDebit(confirmed) || confirmed.scheduled_date !== generated.scheduled_date) return false
  const issuerKey = (value: string) => normalizeName(value).replace(/銀行|カード|引き落とし|引落|請求|見込み/g, '')
  const confirmedName = issuerKey(`${confirmed.name} ${confirmed.memo ?? ''}`)
  const generatedName = issuerKey(generated.name)
  return Boolean(confirmedName && generatedName) &&
    (confirmedName.includes(generatedName) || generatedName.includes(confirmedName))
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
  // 確定請求額が入っているサイクルは、見込みを完全に取り下げる。
  // 残すと同じ請求が「見込み」と「確定」で二重に残高から引かれる。
  const confirmedStatements = indexConfirmedStatements(scheduledPayments)
  const generatedPayments = buildGeneratedCreditPayments(transactions, creditCards, projectionDays)
    .filter(payment => !confirmedStatements.has(`${payment.credit_card_id}|${payment.scheduled_date}`))
    .filter(payment => !scheduledPayments.some(confirmed => confirmedPaymentMatchesGenerated(confirmed, payment)))
  const profile = profileRes.data ?? {
    initial_balance: balanceRes.data?.balance ?? 0,
    monthly_income: 0,
    income_day: 25,
  }
  const currentBalance = balanceRes.data?.balance ?? 0
  // 外貨建て固定費(ジブラルタ生命 105 USD 等)を円換算するためのレート
  const fxRates = await loadFxRates()

  // カード払いの固定費のうち、実際のカード利用として既に取り込まれているものを特定する。
  // ここで取り下げないと、同じ支出が「固定費の予測」と「カード請求に含まれる実取引」で
  // 二重に残高から引かれる。
  const fixedCostMatches = matchFixedCostsToCardUsage(scheduledPayments, creditCards, transactions)

  // 確定請求額が入っているサイクルでは、カード払い固定費の予測を一切足さない。
  // 確定額はそのサイクルの総額なので、電気代・ガス代なども既に含まれている。
  const thisMonth = new Date().toISOString().slice(0, 7)
  const projectionMonths = [-1, 0, 1, 2, 3].map(offset => addMonthKey(thisMonth, offset))
  const suppressedDebits = new Set([
    ...suppressedDebitKeys(fixedCostMatches),
    ...suppressedByConfirmedCycles(
      scheduledPayments,
      creditCards,
      new Set(confirmedStatements.keys()),
      projectionMonths
    ),
  ])

  const projectedDays = projectCashflow(
    currentBalance,
    [...scheduledPayments, ...generatedPayments],
    projectionDays,
    {
      monthlyIncome: profile.monthly_income ?? 0,
      incomeDay: profile.income_day ?? 25,
      // カード払いの固定費をカードの支払日・引落口座へ付け替えるために渡す
      creditCards,
      fxRates,
      suppressedDebits,
    }
  )

  return Response.json({
    currentBalance: balanceRes.data,
    projectedDays,
    scheduledPayments,
    generatedPayments,
    creditCards,
    profile,
    // どのカード設定にも紐づかなかったカード利用。請求見込みから抜け落ちるので画面で警告する
    unassignedCardUsage: findUnassignedCardUsage(transactions, creditCards),
    // 締め前も含めた「これから引き落とされるカードのサイクル」。
    // 予測ウィンドウ(2ヶ月)の外に出る支払日も、ここでは必ず見える。
    cardCycles: buildCardCycles(transactions, creditCards, new Date(), confirmedStatements),
    // 実カード利用と照合できた固定費（＝予測から取り下げたもの）
    fixedCostMatches,
    // 照合キーワードが無いカード払い固定費。実取引が来ていれば二重計上している
    unmatchedCardFixedCosts: findUnmatchedCardFixedCosts(scheduledPayments).map(payment => ({
      id: payment.id,
      name: payment.name,
      amount: payment.amount,
    })),
  })
}
