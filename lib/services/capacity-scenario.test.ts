// 最終レビューのシナリオ（2026-11-24 PR-1 final review）を、ローダーと同じ組み立て
// （buildCapacityObligations → computeInvestmentCapacity）で通す。
// 数字は固定。実装が違う数字を出したら、期待値を変えずに差を説明すること。
//
// 今日 2026-11-28、対象月 2026-11
//   口座A ¥900,000（記録 11/27、給与口座だがシステム上は不明）
//   口座B ¥400,000（記録 11/20）
//   給与 ¥300,000（25日、実績0）
//   SMBC（15日締め・10日払い・引落A）: 9/20 ¥50k（11/10 引落済み）、10/20 ¥80k（確定請求 ¥82k・12/10）、
//     締め前 ¥20k（1/12 引落）
//   楽天カード（月末締め・27日払い・引落B）: ¥40k（11/27 引落）、締め前 ¥15k
//   口座積立 ¥30k（11/27・A・買付11/27）、楽天カード積立 ¥50k（11/1・買付11/1・カード利用は未取込）
//   自動車保険（年払い）¥60k 11/30 B、USD保険 ¥16k 11/27 A、家賃 ¥80k 11/27 B、
//   Netflix ¥1,590（カード払い・11/29・未請求）
//   残り生活費 ¥30k、予備費 ¥100k、必要防衛資金 ¥600k、貯蓄目標 ¥50k、投資目標 ¥100k
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCapacityObligations, salaryIncome } from './capacity-obligations'
import { computeInvestmentCapacity } from './investment-capacity'
import { matchFixedCostsToCardUsage } from './fixed-cost-matching'
import type { CreditCardSetting, ResolvedScheduledPayment } from '@/types/cashflow'
import type { Transaction } from '@/types/transaction'

const TODAY = '2026-11-28'
const MONTH = '2026-11'
const A = 'acct-a'
const B = 'acct-b'

const cards: CreditCardSetting[] = [
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

const transactions: Transaction[] = [
  usage('s1', '2026-09-20', 50000, '三井住友カード'), // 9/16〜10/15 → 11/10 引落済み
  usage('s2', '2026-10-20', 80000, '三井住友カード'), // 10/16〜11/15 → 12/10（確定 ¥82,000）
  usage('s3', '2026-11-20', 20000, '三井住友カード'), // 11/16〜12/15 → 1/12（締め前）
  usage('r1', '2026-10-10', 40000, '楽天カード'), // 10月 → 11/27 引落
  usage('r2', '2026-11-10', 15000, '楽天カード'), // 11月 → 12/28（締め前）
]

function payment(overrides: Partial<ResolvedScheduledPayment>): ResolvedScheduledPayment {
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

const payments: ResolvedScheduledPayment[] = [
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

const buys = [
  { trade_date: '2026-11-27', amount: 30000 },
  { trade_date: '2026-11-01', amount: 50000 },
]

test('シナリオ：最終レビューの数字（入金0・カード208,590・固定費156,000・投資30,000・投資可能額775,410）', () => {
  const balanceDateByAccount = new Map([
    [A, '2026-11-27'],
    [B, '2026-11-20'],
  ])
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
    oldestBalanceDate: '2026-11-20',
    fixedNames: ['住居費', '保険', '通信費'],
    salary: salaryIncome({ month: MONTH, planned: 300000, actual: 0, incomeDay: 25 }),
  })
  assert.ok(obligations && outflows)

  const investmentDeducted = outflows.scheduledDeduction + outflows.buyDeduction
  const capacity = computeInvestmentCapacity({
    month: MONTH,
    availableCash: 900000 + 400000,
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
    missingData: [],
    balanceOldestRecordedAt: '2026-11-20T09:00:00+09:00',
    balanceAccounts: [
      { accountId: A, recordedAt: '2026-11-27T09:00:00+09:00' },
      { accountId: B, recordedAt: '2026-11-20T09:00:00+09:00' },
    ],
    now: new Date('2026-11-28T12:00:00+09:00'),
  })

  // 内訳を先に出しておく（違ったときに1円ずつ説明できるように）
  const items = obligations.items.map(i => `${i.kind}:${i.label}:${i.amount}`)
  assert.equal(obligations.expectedIncome, 0, items.join('\n'))
  assert.equal(obligations.cardUnpaid, 208590, items.join('\n'))
  assert.equal(obligations.fixedUnpaid + obligations.scheduledUnpaid, 156000, items.join('\n'))
  assert.equal(investmentDeducted, 30000)
  assert.equal(capacity.personal_cash_floor, 130000)
  assert.equal(capacity.investable_amount, 775410)
  assert.deepEqual(capacity.allocation, {
    emergency_fund: 600000,
    savings: 50000,
    asset_building: 100000,
    unallocated_cash: 25410,
  })
})

// I-5 を同じ組み立て（buildCapacityObligations）で確認する
test('I-5 組み立て：カード払いの変動額の固定費は直近3か月の照合額の平均で1回差し引き、決められないものは missing_data', () => {
  const variable = [
    payment({
      id: 'gas',
      name: 'ガス代',
      category: '保険',
      payment_method: 'credit_card',
      credit_card_id: 'rakuten',
      amount_type: 'variable',
      due_day: 5,
      amount: 0,
      resolvedDueDate: '2026-11-05',
      resolvedAmountYen: 0,
    }),
    payment({ id: 'water', name: '水道代', category: '保険', amount_type: 'variable', amount: 0, resolvedAmountYen: 0, debit_account_id: B }),
  ]
  const match = (month: string, amount: number) => ({
    paymentId: 'gas',
    paymentName: 'ガス代',
    amount,
    paymentDate: `${month}-27`,
    month,
    transactionIds: [`g-${month}`],
  })
  const { obligations } = buildCapacityObligations({
    today: TODAY,
    month: MONTH,
    monthEnd: '2026-11-30',
    payments: variable,
    creditCards: cards,
    transactions: [],
    fixedCostMatches: [match('2026-08', 5000), match('2026-09', 4000), match('2026-10', 6000)],
    buys: [],
    balanceDateByAccount: new Map([[A, '2026-11-27'], [B, '2026-11-20']]),
    oldestBalanceDate: '2026-11-20',
    fixedNames: ['保険'],
    salary: null,
  })
  assert.ok(obligations)
  assert.equal(obligations.cardUnpaid, 5000) // (5,000 + 4,000 + 6,000) ÷ 3、楽天 12/28 引落
  assert.ok(obligations.items.some(i => i.kind === 'card' && i.label === 'ガス代（2026-12-28引落）' && i.amount === 5000))
  assert.equal(obligations.fixedUnpaid, 0)
  assert.deepEqual(obligations.missingData, ['変動額の固定費「水道代」の金額が不明です'])
})
