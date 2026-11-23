// lib/services/capacity-input.ts
//
// 投資可能額（computeInvestmentCapacity）の入力を集める唯一の入口(I/O)。
//
// 以前は Integration API（investment-capacity/route.ts）と資産計画
// （asset-planning-loader.ts）が同じ組み立てをコピーして持っており、
//   ・日付・繰り返し・支払済み月・支払方法に関係なく有効な予定支払いを全部足す
//   ・type:'income' を支出として数える（F17）
//   ・保存済みの確定請求だけを数え、締め前のカード利用を落とす
// という誤りが両方に入っていた。ここへ一本化し、計算は capacity-obligations.ts の
// 純関数に置く。**新しい金融式をここに書かない。**
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMergedCategories } from '@/lib/categories'
import { indexConfirmedStatements } from '@/lib/cashflow'
import { toJstDateKey } from '@/lib/jst'
import { loadBudget, monthEnd, monthStart, type BudgetLoad } from './budget-loader'
import { loadLiquidCash } from './liquid-cash-loader'
import { loadResolvedScheduledPayments } from './scheduled-payments-loader'
import { computeLivingBuffer, type LivingBufferResult } from './living-buffer'
import { computeEmergencyFund, type EmergencyFundResult } from './emergency-fund'
import { essentialMonthlyExpenses } from './asset-planning'
import { matchFixedCostsToCardUsage } from './fixed-cost-matching'
import { isCardBillPayment, isInvestmentCategory } from './money-plan'
import { yen } from './money'
import {
  bufferWindow,
  capacityCardCycles,
  computeObligations,
  summarizeBufferSpending,
  type Obligations,
} from './capacity-obligations'
import type { CapacityInput } from './investment-capacity'
import type { LiquidCash } from './liquid-cash'
import type { CreditCardSetting, ResolvedScheduledPayment } from '@/types/cashflow'
import type { Transaction } from '@/types/transaction'
import type { BudgetTransaction } from '@/types/budget'

export { computeObligations } from './capacity-obligations'

/** 呼び出し側が投資可能額以外の表示に使う、同じリクエストで読んだ値 */
export type CapacityLoadContext = {
  today: string
  budgetLoad: BudgetLoad
  liquidCash: LiquidCash
  resolvedPayments: ResolvedScheduledPayment[]
  emergencyFund: EmergencyFundResult
  livingBuffer: LivingBufferResult
  /** 残高が不明（記録日が無い）なら null。0円の内訳と混同しない */
  obligations: Obligations | null
}

/**
 * CapacityInput に、同じ読み込みの結果（context）を添えたもの。
 * computeInvestmentCapacity へは context を外して渡す。
 */
export type LoadedCapacityInput = CapacityInput & { context: CapacityLoadContext }

/** 残高の記録時刻 → 日本時間の記録日 'YYYY-MM-DD' */
function balanceDateKey(recordedAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(recordedAt)) return recordedAt
  const time = Date.parse(recordedAt)
  return Number.isFinite(time) ? toJstDateKey(new Date(time)) : recordedAt.slice(0, 10)
}

export async function loadCapacityInput(
  userId: string,
  month: string,
  now: Date,
  supabase: SupabaseClient
): Promise<LoadedCapacityInput> {
  const today = toJstDateKey(now)
  const window = bufferWindow(today)

  const [
    budgetLoad,
    liquidCash,
    resolvedPayments,
    categories,
    cardsRes,
    transactionsRes,
    investmentRes,
    profileRes,
  ] = await Promise.all([
    loadBudget(userId, month, today, supabase),
    loadLiquidCash(userId, supabase),
    // 取得失敗はローダー側で throw する（0件の予定として流さない）
    loadResolvedScheduledPayments(userId, month, supabase),
    getMergedCategories(userId, supabase),
    supabase.from('credit_cards').select('*').eq('user_id', userId),
    // 過去120日。カードのサイクルと90日バッファの両方に使う
    supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .gte('date', window.fetchFrom)
      .lte('date', today),
    supabase
      .from('investment_transactions')
      .select('trade_date, amount_jpy, trade_type')
      .eq('user_id', userId)
      .gte('trade_date', monthStart(month))
      .lte('trade_date', monthEnd(month)),
    supabase
      .from('users_profile')
      .select('emergency_fund_months')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  // 金融計算では「DB取得失敗 = 0円」にしない。欠損のまま計算すると
  // 未払い予定が0円になり、投資余力が実態より大きく出る
  for (const [label, res] of [
    ['credit_cards', cardsRes],
    ['transactions', transactionsRes],
    ['investment_transactions', investmentRes],
    ['users_profile', profileRes],
  ] as const) {
    if (res.error) throw new Error(`${label} の取得に失敗しました: ${res.error.message}`)
  }

  const budget = budgetLoad.summary
  const missingData: string[] = []
  const creditCards = (cardsRes.data ?? []) as CreditCardSetting[]
  const transactions = (transactionsRes.data ?? []) as (Transaction & {
    scheduled_payment_id?: string | null
  })[]

  // カード払い固定費のうち、実際のカード利用として取り込まれているもの
  const fixedCostMatches = matchFixedCostsToCardUsage(resolvedPayments, creditCards, transactions)

  // 生活用バッファ = max(直近90日の変動生活費 ÷ 90 × 30 × 1.2, 固定予備費)
  const bufferSpending = summarizeBufferSpending(
    transactions.map(
      (tx): BudgetTransaction => ({
        id: tx.id,
        date: tx.date,
        amount: yen(tx.amount),
        category: tx.category,
        kind: tx.kind ?? 'expense',
        memo: tx.memo ?? null,
        payment_method: tx.payment_method ?? null,
        scheduled_payment_id: tx.scheduled_payment_id ?? null,
      })
    ),
    {
      today,
      fixedNames: categories.fixedNames,
      excludeTransactionIds: fixedCostMatches.flatMap(match => match.transactionIds),
    }
  )
  const livingBuffer = computeLivingBuffer({
    variableSpend90d: bufferSpending.variableSpend90d,
    dataCoverageDays: bufferSpending.dataCoverageDays,
    fixedBuffer: budget.buffer,
  })
  missingData.push(...livingBuffer.missingData)

  // 口座ごとの残高記録日。引落口座の記録日より前の支払いは残高に反映済み
  const balanceDateByAccount = new Map<string, string>()
  for (const account of liquidCash.accounts) {
    if (account.recordedAt) balanceDateByAccount.set(account.accountId, balanceDateKey(account.recordedAt))
  }
  const oldestBalanceDate = liquidCash.oldestRecordedAt ? balanceDateKey(liquidCash.oldestRecordedAt) : null

  // 残高が分からないときは未払いを計算しない。投資可能額は null（不明）になる
  const obligations =
    oldestBalanceDate === null
      ? null
      : computeObligations({
          today,
          monthEnd: monthEnd(month),
          scheduled: resolvedPayments,
          cardCycles: capacityCardCycles(transactions, creditCards, {
            today,
            since: oldestBalanceDate,
            confirmedStatements: indexConfirmedStatements(resolvedPayments),
          }),
          matchedFixedCostIds: new Set(
            fixedCostMatches.filter(match => match.month === month).map(match => match.paymentId)
          ),
          balanceDateByAccount,
          oldestBalanceDate,
          fixedNames: new Set(categories.fixedNames),
        })

  const availableCash = oldestBalanceDate === null ? null : liquidCash.amount
  if (availableCash === null) missingData.push('口座残高が未登録です')
  if (budget.income.planned === 0) missingData.push('月収の設定がありません')

  // 今月すでに投資に回した額（買付のみ）
  const alreadyInvested = (investmentRes.data ?? [])
    .filter(tx => /買|buy|購入|積立|再投資/.test(String(tx.trade_type ?? '').toLowerCase()))
    .reduce((sum, tx) => sum + Math.abs(Number(tx.amount_jpy) || 0), 0)

  // 防衛資金（Task 5 で見直すまで従来どおり）。積立投資は生活固定費に含めない
  const investmentFixed = resolvedPayments
    .filter(p => p.is_active && !isCardBillPayment(p) && isInvestmentCategory(p.category))
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const emergencyFund = computeEmergencyFund({
    monthlyEssentialExpenses: essentialMonthlyExpenses({
      livingFixed: Math.max(budget.fixed.effective - investmentFixed, 0),
      variableBudget: budget.variable.budget,
    }),
    currentLiquidCash: liquidCash.amount,
    targetMonths: Number(profileRes.data?.emergency_fund_months ?? 3),
  })

  return {
    month,
    availableCash,
    expectedIncome: obligations?.expectedIncome ?? 0,
    confirmedIncome: budget.income.actual,
    confirmedExpenses: budget.variable.spent,
    pendingCardAmount: obligations?.cardUnpaid ?? 0,
    fixedExpenses: obligations?.fixedUnpaid ?? 0,
    scheduledExpenses: obligations?.scheduledUnpaid ?? 0,
    livingReserve: Math.max(0, budget.variable.remaining),
    buffer: livingBuffer.amount,
    alreadyInvested,
    // 配分の優先順: 防衛資金の補充 → 貯蓄目標 → 投資目標 → 自由
    reserveGap: emergencyFund.reserveGap ?? 0,
    savingsTarget: budget.savings.target,
    investmentTarget: budget.investment.target,
    missingData,
    balanceOldestRecordedAt: liquidCash.oldestRecordedAt,
    balanceAccounts: liquidCash.accounts,
    now,
    context: {
      today,
      budgetLoad,
      liquidCash,
      resolvedPayments,
      emergencyFund,
      livingBuffer,
      obligations,
    },
  }
}
