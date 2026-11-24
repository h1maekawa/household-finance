// 最終レビューのシナリオ入力（capacity-scenario.test.ts と AI Company 向けフィクスチャ生成が共有する）。
// すべて架空値。数字を変えるときは両方のテストの期待値を確認すること。
import { buildCapacityObligations, salaryIncome } from '../capacity-obligations'
import { computeInvestmentCapacity } from '../investment-capacity'
import { matchFixedCostsToCardUsage } from '../fixed-cost-matching'
import type { CreditCardSetting, ResolvedScheduledPayment } from '@/types/cashflow'
import type { Transaction } from '@/types/transaction'

export const TODAY = '2026-11-28'
export const MONTH = '2026-11'
export const A = 'acct-a'
export const B = 'acct-b'

export const cards: CreditCardSetting[] = [
  {
    id: 'smbc',
    name: '三井住友カード',
    closing_day: '15',
    payment_day: '10',
    closing_day_int: 15,
    payment_day_int: 10,
    payment_month_offset: 1,
    card_plan: 'smbc_10th',
    debit_account_id: A,
  } as CreditCardSetting,
  {
    id: 'rakuten',
    name: '楽天カード',
    closing_day: '31',
    payment_day: '27',
    closing_day_int: 31,
    payment_day_int: 27,
    payment_month_offset: 1,
    card_plan: 'rakuten_standard',
    debit_account_id: B,
  } as CreditCardSetting,
]

function usage(id: string, date: string, amount: number, cardName: string): Transaction {
  return {
    id,
    date,
    amount,
    category: '食費',
    payment_method: cardName,
    source: 'gmail',
    kind: 'expense',
    created_at: '',
    updated_at: '',
  } as Transaction
}

export const transactions: Transaction[] = [
  usage('s1', '2026-09-20', 50000, '三井住友カード'), // 9/16〜10/15 → 11/10 引落済み
  usage('s2', '2026-10-20', 80000, '三井住友カード'), // 10/16〜11/15 → 12/10（確定 ¥82,000）
  usage('s3', '2026-11-20', 20000, '三井住友カード'), // 11/16〜12/15 → 1/12（締め前）
  usage('r1', '2026-10-10', 40000, '楽天カード'), // 10月 → 11/27 引落
  usage('r2', '2026-11-10', 15000, '楽天カード'), // 11月 → 12/28（締め前）
]

export function payment(overrides: Partial<ResolvedScheduledPayment>): ResolvedScheduledPayment {
  return {
    id: 'x',
    name: '予定',
    amount: 0,
    due_day: 27,
    category: '住居費',
    type: 'fixed',
    is_active: true,
    payment_method: 'bank_debit',
    debit_account_id: null,
    last_paid_month: null,
    created_at: '2026-01-01T00:00:00Z',
    resolvedDueDate: '2026-11-27',
    resolvedAmountYen: 0,
    debitAccountName: null,
    ...overrides,
  }
}

export const payments: ResolvedScheduledPayment[] = [
  payment({
    id: 'smbc-statement',
    name: '三井住友カード 確定請求',
    type: 'credit',
    category: 'クレカ請求',
    source: 'card_statement',
    credit_card_id: 'smbc',
    scheduled_date: '2026-12-10',
    due_day: 10,
    amount: 82000,
    resolvedDueDate: null,
    resolvedAmountYen: 82000,
  }),
  payment({ id: 'bank-tsumitate', name: '口座積立', category: '投資', amount: 30000, resolvedAmountYen: 30000, debit_account_id: A }),
  payment({
    id: 'rakuten-tsumitate',
    name: '楽天カード積立',
    category: '投資',
    payment_method: 'credit_card',
    credit_card_id: 'rakuten',
    due_day: 1,
    amount: 50000,
    resolvedDueDate: '2026-11-01',
    resolvedAmountYen: 50000,
  }),
  payment({
    id: 'car',
    name: '自動車保険',
    category: '保険',
    recurrence: 'yearly',
    start_date: '2025-11-30',
    due_day: 30,
    amount: 60000,
    resolvedDueDate: '2026-11-30',
    resolvedAmountYen: 60000,
    debit_account_id: B,
  }),
  payment({
    id: 'usd',
    name: 'USD保険',
    category: '保険',
    currency: 'USD',
    foreign_amount: 105,
    amount: 105,
    resolvedAmountYen: 16000,
    debit_account_id: A,
  }),
  payment({ id: 'rent', name: '家賃', category: '住居費', amount: 80000, resolvedAmountYen: 80000, debit_account_id: B }),
  payment({
    id: 'netflix',
    name: 'Netflix',
    category: '通信費',
    payment_method: 'credit_card',
    credit_card_id: 'smbc',
    due_day: 29,
    amount: 1590,
    resolvedDueDate: '2026-11-29',
    resolvedAmountYen: 1590,
  }),
]

export const buys = [
  { trade_date: '2026-11-27', amount: 30000 },
  { trade_date: '2026-11-01', amount: 50000 },
]

export const SCENARIO_NOW = new Date('2026-11-28T12:00:00+09:00')

/** 口座Bの記録時刻だけがケースで変わる。null なら口座残高なし（unknown） */
export function runScenario(balanceBRecordedAt: string | null) {
  const aRecorded = '2026-11-27T09:00:00+09:00'
  const dateOf = (iso: string) => iso.slice(0, 10)
  const known = balanceBRecordedAt !== null
  const balanceDateByAccount = new Map<string, string>([[A, dateOf(aRecorded)]])
  if (balanceBRecordedAt) balanceDateByAccount.set(B, dateOf(balanceBRecordedAt))
  const oldest = balanceBRecordedAt ? dateOf(balanceBRecordedAt) : dateOf(aRecorded)
  const { obligations, outflows } = buildCapacityObligations({
    today: TODAY,
    month: MONTH,
    monthEnd: '2026-11-30',
    payments,
    creditCards: cards,
    transactions,
    fixedCostMatches: matchFixedCostsToCardUsage(payments, cards, transactions),
    buys,
    balanceDateByAccount,
    oldestBalanceDate: oldest,
    fixedNames: ['住居費', '保険', '通信費'],
    salary: salaryIncome({ month: MONTH, planned: 300000, actual: 0, incomeDay: 25 }),
  })
  if (!obligations || !outflows) throw new Error('シナリオの組み立てに失敗')
  const investmentDeducted = outflows.scheduledDeduction + outflows.buyDeduction
  const capacity = computeInvestmentCapacity({
    month: MONTH,
    availableCash: known ? 900000 + 400000 : null,
    expectedIncome: obligations.expectedIncome,
    confirmedIncome: 0,
    confirmedExpenses: 0,
    pendingCardAmount: obligations.cardUnpaid,
    fixedExpenses: obligations.fixedUnpaid,
    scheduledExpenses: obligations.scheduledUnpaid,
    livingReserve: 30000,
    buffer: 100000,
    alreadyInvested: 80000,
    investmentDeducted,
    requiredReserve: 600000,
    savingsTarget: 50000,
    investmentTarget: 100000,
    missingData: known ? [] : ['口座残高が未登録です'],
    balanceOldestRecordedAt: known ? balanceBRecordedAt : null,
    balanceAccounts: known
      ? [
          { accountId: A, recordedAt: aRecorded },
          { accountId: B, recordedAt: balanceBRecordedAt },
        ]
      : [],
    now: SCENARIO_NOW,
  })
  return { obligations, outflows, investmentDeducted, capacity }
}
