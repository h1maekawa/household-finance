// 投資可能額の入力（capacity-input）の純関数部分。
// I/O の loadCapacityInput は capacity-input.ts、計算はここで固定する。
// 今日 = 2026-11-24、対象月 = 2026-11
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeObligations,
  summarizeBufferSpending,
  capacityCardCycles,
  bufferWindow,
  salaryIncome,
  sumInvestedAfterBalance,
  computeInvestmentOutflows,
  isBuyTradeType,
} from './capacity-obligations'
import { computeInvestmentCapacity, type CapacityInput } from './investment-capacity'
import type { CardCycle } from '@/lib/cashflow'
import type { CreditCardSetting, ResolvedScheduledPayment } from '@/types/cashflow'
import type { Transaction } from '@/types/transaction'
import type { BudgetTransaction } from '@/types/budget'

const TODAY = '2026-11-24'
const MONTH_END = '2026-11-30'

function payment(overrides: Partial<ResolvedScheduledPayment>): ResolvedScheduledPayment {
  return {
    id: overrides.id ?? `p-${Math.random()}`,
    name: '固定費',
    amount: 0,
    due_day: 27,
    category: '通信費',
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

function cycle(overrides: Partial<CardCycle>): CardCycle {
  return {
    periodStart: '2026-10-16',
    periodEnd: '2026-11-15',
    paymentDate: '2026-12-10',
    cardId: 'card-1',
    cardName: 'テストカード',
    amount: 0,
    transactionCount: 1,
    open: true,
    debitAccountId: null,
    confirmedAmount: null,
    ...overrides,
  }
}

const FIXED = new Set(['通信費', '水道光熱費', '保険'])

function obligations(overrides: Partial<Parameters<typeof computeObligations>[0]>) {
  return computeObligations({
    today: TODAY,
    monthEnd: MONTH_END,
    scheduled: [],
    cardCycles: [],
    matchedFixedCostIds: new Set(),
    balanceDateByAccount: new Map(),
    oldestBalanceDate: '2026-11-23',
    fixedNames: FIXED,
    ...overrides,
  })
}

test('年払い（11月は対象外で resolvedDueDate が null）は0円', () => {
  const result = obligations({
    scheduled: [
      payment({ recurrence: 'yearly', resolvedDueDate: null, amount: 120000, resolvedAmountYen: 120000 }),
    ],
  })
  assert.equal(result.fixedUnpaid, 0)
  assert.equal(result.scheduledUnpaid, 0)
  assert.equal(result.items.length, 0)
})

test('確定請求（type:credit）は計上せず、カードは締め前の利用額をサイクルから数える', () => {
  const result = obligations({
    scheduled: [
      payment({
        type: 'credit',
        category: 'クレカ請求',
        resolvedDueDate: '2026-11-10',
        amount: 50000,
        resolvedAmountYen: 50000,
        last_paid_month: '2026-11',
      }),
    ],
    cardCycles: [cycle({ paymentDate: '2026-12-10', open: true, amount: 42000, confirmedAmount: null })],
  })
  assert.equal(result.cardUnpaid, 42000)
  assert.equal(result.fixedUnpaid, 0)
  assert.equal(result.scheduledUnpaid, 0)
})

test('確定請求（type:credit）は支払日が未来でも予定支払いとしては数えない（カード側で1回だけ）', () => {
  const result = obligations({
    scheduled: [
      payment({ type: 'credit', category: 'クレカ請求', resolvedDueDate: '2026-11-27', resolvedAmountYen: 50000 }),
    ],
  })
  assert.equal(result.fixedUnpaid + result.scheduledUnpaid, 0)
  assert.equal(result.cardUnpaid, 50000)
})

test('サイクルに確定額があれば利用合計ではなく確定額を使う', () => {
  const result = obligations({
    cardCycles: [cycle({ paymentDate: '2026-12-10', open: false, amount: 42000, confirmedAmount: 45000 })],
  })
  assert.equal(result.cardUnpaid, 45000)
})

test('カード払いの電気代は固定費に入らない', () => {
  const result = obligations({
    scheduled: [
      payment({
        name: '電気代',
        category: '水道光熱費',
        payment_method: 'credit_card',
        credit_card_id: 'card-1',
        amount: 8000,
        resolvedAmountYen: 8000,
      }),
    ],
  })
  assert.equal(result.fixedUnpaid, 0)
  assert.equal(result.scheduledUnpaid, 0)
})

test('カード利用と照合済みの固定費は数えない', () => {
  const result = obligations({
    scheduled: [payment({ id: 'matched', amount: 3000, resolvedAmountYen: 3000 })],
    matchedFixedCostIds: new Set(['matched']),
  })
  assert.equal(result.fixedUnpaid, 0)
})

test('USD建ての固定費は円換算額で数える', () => {
  const result = obligations({
    scheduled: [
      payment({
        name: '生命保険',
        category: '保険',
        currency: 'USD',
        foreign_amount: 105,
        amount: 105,
        resolvedAmountYen: 16000,
      }),
    ],
  })
  assert.equal(result.fixedUnpaid, 16000)
})

test('固定費カテゴリ以外の予定支払いは scheduledUnpaid に入る', () => {
  const result = obligations({
    scheduled: [payment({ category: '交際費', amount: 7000, resolvedAmountYen: 7000 })],
  })
  assert.equal(result.fixedUnpaid, 0)
  assert.equal(result.scheduledUnpaid, 7000)
})

test('type:income は支出ではなく入金予定に入る（F17）', () => {
  const result = obligations({
    scheduled: [
      payment({
        name: '給与',
        type: 'income',
        category: '給与',
        resolvedDueDate: '2026-11-25',
        amount: 300000,
        resolvedAmountYen: 300000,
      }),
    ],
  })
  assert.equal(result.expectedIncome, 300000)
  assert.equal(result.fixedUnpaid, 0)
  assert.equal(result.scheduledUnpaid, 0)
  assert.equal(result.cardUnpaid, 0)
  assert.deepEqual(
    result.items.map(i => i.kind),
    ['income']
  )
})

test('今月支払い済み（last_paid_month が当月）でも、記録日より前に引き落とされたものだけ差し引かない（I-2）', () => {
  const result = obligations({
    oldestBalanceDate: '2026-11-23',
    scheduled: [
      payment({ last_paid_month: '2026-11', resolvedDueDate: '2026-11-20', amount: 5000, resolvedAmountYen: 5000 }),
      payment({ last_paid_month: '2026-11', resolvedDueDate: '2026-11-27', amount: 7000, resolvedAmountYen: 7000 }),
    ],
  })
  assert.equal(result.fixedUnpaid, 7000)
})

test('月末より後の予定支払いは数えない', () => {
  const result = obligations({
    scheduled: [payment({ resolvedDueDate: '2026-12-01', amount: 5000, resolvedAmountYen: 5000 })],
  })
  assert.equal(result.fixedUnpaid, 0)
})

test('無効（is_active:false）の予定支払いは数えない', () => {
  const result = obligations({
    scheduled: [payment({ is_active: false, amount: 5000, resolvedAmountYen: 5000 })],
  })
  assert.equal(result.fixedUnpaid, 0)
})

test('残高の記録日より前に引き落とされたカード請求は差し引かない（同日・後は差し引く）', () => {
  const result = obligations({
    balanceDateByAccount: new Map([['A', '2026-11-12']]),
    oldestBalanceDate: '2026-11-12',
    cardCycles: [
      cycle({ cardId: 'c1', paymentDate: '2026-11-10', open: false, amount: 30000, confirmedAmount: 30000, debitAccountId: 'A' }),
      cycle({ cardId: 'c2', paymentDate: '2026-11-15', open: false, amount: 20000, confirmedAmount: null, debitAccountId: 'A' }),
      cycle({ cardId: 'c3', paymentDate: '2026-11-12', open: false, amount: 7000, confirmedAmount: null, debitAccountId: 'A' }),
    ],
  })
  assert.equal(result.cardUnpaid, 27000)
})

test('予定支払いは引落口座ごとの記録日で判定する', () => {
  const result = obligations({
    balanceDateByAccount: new Map([
      ['A', '2026-11-20'],
      ['B', '2026-11-05'],
    ]),
    oldestBalanceDate: '2026-11-05',
    scheduled: [
      payment({ name: '家賃A', debit_account_id: 'A', resolvedDueDate: '2026-11-18', resolvedAmountYen: 80000 }),
      payment({ name: '保険B', debit_account_id: 'B', resolvedDueDate: '2026-11-18', resolvedAmountYen: 6000 }),
    ],
  })
  assert.equal(result.fixedUnpaid, 6000)
})

test('引落口座が不明・記録の無い口座は最も古い記録日で判定する', () => {
  const result = obligations({
    balanceDateByAccount: new Map([['A', '2026-11-20']]),
    oldestBalanceDate: '2026-11-05',
    scheduled: [
      payment({ debit_account_id: null, resolvedDueDate: '2026-11-18', resolvedAmountYen: 1000 }),
      payment({ debit_account_id: 'Z', resolvedDueDate: '2026-11-18', resolvedAmountYen: 2000 }),
    ],
    cardCycles: [cycle({ paymentDate: '2026-11-10', amount: 4000, debitAccountId: null })],
  })
  assert.equal(result.fixedUnpaid, 3000)
  assert.equal(result.cardUnpaid, 4000)
})

test('入金は記録日より後だけ足す（同日は反映済みか分からないので足さない）', () => {
  const income = (date: string) =>
    payment({ name: `給与${date}`, type: 'income', category: '給与', resolvedDueDate: date, resolvedAmountYen: 100000 })
  const result = obligations({
    balanceDateByAccount: new Map(),
    oldestBalanceDate: '2026-11-20',
    scheduled: [income('2026-11-20'), income('2026-11-25')],
  })
  assert.equal(result.expectedIncome, 100000)
})

// ---------------------------------------------------------------- 90日バッファ

test('90日窓は今日を含む [today-89, today]、取得は120日分', () => {
  assert.deepEqual(bufferWindow(TODAY), {
    from: '2026-08-27',
    to: '2026-11-24',
    fetchFrom: '2026-07-28',
  })
})

function btx(overrides: Partial<BudgetTransaction>): BudgetTransaction {
  return {
    id: `t-${Math.random()}`,
    date: '2026-11-01',
    amount: 1000,
    category: '食費',
    kind: 'expense',
    scheduled_payment_id: null,
    ...overrides,
  }
}

test('90日の変動費から投資・固定費・窓の外を除き、データ日数を数える', () => {
  const result = summarizeBufferSpending(
    [
      btx({ date: '2026-07-28', amount: 999 }), // 窓の外（120日の取得範囲の先頭）
      btx({ date: '2026-08-27', amount: 1000 }), // 窓の先頭
      btx({ date: '2026-11-24', amount: 2000 }), // 今日
      btx({ date: '2026-11-01', amount: 30000, category: '投資' }),
      btx({ date: '2026-11-01', amount: 9000, category: '通信費' }),
      btx({ id: 'matched', date: '2026-11-02', amount: 500 }),
      btx({ date: '2026-11-03', amount: 400, kind: 'income' }),
    ],
    { today: TODAY, fixedNames: ['通信費'], excludeTransactionIds: ['matched'] }
  )
  assert.equal(result.variableSpend90d, 3000)
  assert.equal(result.dataCoverageDays, 120)
})

test('取引が無ければデータ日数は0', () => {
  const result = summarizeBufferSpending([], { today: TODAY, fixedNames: [] })
  assert.equal(result.dataCoverageDays, 0)
})

test('データ日数は最古の取引日から今日まで（両端含む）', () => {
  const result = summarizeBufferSpending([btx({ date: '2026-11-15T09:00:00' })], {
    today: TODAY,
    fixedNames: [],
  })
  assert.equal(result.dataCoverageDays, 10)
  assert.equal(result.variableSpend90d, 1000)
})

// ---------------------------------------------------------------- カードサイクル

const card: CreditCardSetting = {
  id: 'card-1',
  name: 'テストカード',
  closing_day: '15',
  payment_day: '10',
  closing_day_int: 15,
  payment_day_int: 10,
  payment_month_offset: 1,
  debit_account_id: 'A',
} as CreditCardSetting

function tx(date: string, amount: number): Transaction {
  return {
    id: `x-${date}-${amount}`,
    date,
    amount,
    category: '食費',
    payment_method: 'テストカード',
    source: 'gmail',
    kind: 'expense',
    created_at: '',
    updated_at: '',
  }
}

test('残高記録日以降に引き落とされたサイクルは、今日より前でも残す', () => {
  const cycles = capacityCardCycles([tx('2026-10-01', 30000), tx('2026-11-01', 5000)], [card], {
    today: TODAY,
    since: '2026-11-05',
    confirmedStatements: new Map([['card-1|2026-11-10', 31000]]),
  })
  const byDate = new Map(cycles.map(c => [c.paymentDate, c]))
  // 10/1 利用 → 10/15締め → 11/10払い（今日より前だが記録日 11/5 より後）
  const past = byDate.get('2026-11-10')
  assert.ok(past, '11/10 のサイクルが無い')
  assert.equal(past.open, false)
  assert.equal(past.confirmedAmount, 31000)
  // 11/1 利用 → 11/15締め（今日時点で締め済み）→ 12/10払い
  const next = byDate.get('2026-12-10')
  assert.ok(next)
  assert.equal(next.open, false)
  assert.equal(next.amount, 5000)
})

test('記録日より前に引き落とされたサイクルは含めない', () => {
  const cycles = capacityCardCycles([tx('2026-10-01', 30000)], [card], {
    today: TODAY,
    since: '2026-11-12',
    confirmedStatements: new Map(),
  })
  assert.equal(cycles.length, 0)
})

// ---------------------------------------------------------------- fix round 1


// I-1 給与（users_profile.monthly_income / 予算の income_planned）を入金予定に入れる
test('給与：給料日25日・記録日11/23・今日11/24・予定30万・実績0 → 30万を足す', () => {
  const salary = salaryIncome({ month: '2026-11', planned: 300000, actual: 0, incomeDay: 25 })
  assert.deepEqual(salary, { amount: 300000, date: '2026-11-25' })
  const result = obligations({ oldestBalanceDate: '2026-11-23', salary })
  assert.equal(result.expectedIncome, 300000)
  assert.ok(result.items.some(i => i.kind === 'income' && i.amount === 300000))
})

test('給与：記録日が給料日と同じ（11/25）なら足さない', () => {
  const salary = salaryIncome({ month: '2026-11', planned: 300000, actual: 0, incomeDay: 25 })
  const result = obligations({ today: '2026-11-25', oldestBalanceDate: '2026-11-25', salary })
  assert.equal(result.expectedIncome, 0)
})

test('給与：実績30万が記録済みなら足さない', () => {
  const salary = salaryIncome({ month: '2026-11', planned: 300000, actual: 300000, incomeDay: 25 })
  const result = obligations({ oldestBalanceDate: '2026-11-23', salary })
  assert.equal(result.expectedIncome, 0)
})

test('給与：income_day 31 は11月なら11/30に丸める', () => {
  assert.deepEqual(salaryIncome({ month: '2026-11', planned: 300000, actual: 0, incomeDay: 31 }), {
    amount: 300000,
    date: '2026-11-30',
  })
  assert.equal(salaryIncome({ month: '2026-02', planned: 1, actual: 0, incomeDay: 31 })?.date, '2026-02-28')
})

test('給与：予定が未設定（0）なら給与を作らない', () => {
  assert.equal(salaryIncome({ month: '2026-11', planned: 0, actual: 0, incomeDay: 25 }), null)
})

test('給与：type:income の予定行とは別に数える', () => {
  const salary = salaryIncome({ month: '2026-11', planned: 300000, actual: 0, incomeDay: 25 })
  const result = obligations({
    oldestBalanceDate: '2026-11-23',
    salary,
    scheduled: [
      payment({ name: '副業', type: 'income', category: '副業', resolvedDueDate: '2026-11-28', resolvedAmountYen: 50000 }),
    ],
  })
  assert.equal(result.expectedIncome, 350000)
})

// I-2 取引が取り込まれていないカードの確定請求
function statement(overrides: Partial<ResolvedScheduledPayment>) {
  return payment({
    name: 'テストカード 確定請求',
    type: 'credit',
    category: 'クレカ請求',
    source: 'card_statement',
    credit_card_id: 'card-1',
    scheduled_date: '2026-11-27',
    resolvedDueDate: '2026-11-27',
    amount: 80000,
    resolvedAmountYen: 80000,
    ...overrides,
  })
}

test('確定請求だけがあり、カード利用が取り込まれていない → 1回差し引く', () => {
  const result = obligations({ oldestBalanceDate: '2026-11-23', scheduled: [statement({})] })
  assert.equal(result.cardUnpaid, 80000)
  assert.equal(result.items.filter(i => i.kind === 'card').length, 1)
})

test('確定請求と同じカード・同じ支払日のサイクルがあれば1回だけ（確定額）', () => {
  const result = obligations({
    oldestBalanceDate: '2026-11-23',
    scheduled: [statement({})],
    cardCycles: [cycle({ cardId: 'card-1', paymentDate: '2026-11-27', open: false, amount: 70000, confirmedAmount: 80000 })],
  })
  assert.equal(result.cardUnpaid, 80000)
})

test('確定請求の支払日が記録日より前なら差し引かない', () => {
  const result = obligations({
    oldestBalanceDate: '2026-11-23',
    scheduled: [statement({ scheduled_date: '2026-11-10', resolvedDueDate: '2026-11-10' })],
  })
  assert.equal(result.cardUnpaid, 0)
})

test('確定請求はカードの引落口座の記録日で判定する', () => {
  const result = obligations({
    balanceDateByAccount: new Map([['A', '2026-11-28']]),
    oldestBalanceDate: '2026-11-20',
    cardDebitAccountById: new Map([['card-1', 'A']]),
    scheduled: [statement({})], // 11/27 < 口座Aの記録日 11/28 → 反映済み
  })
  assert.equal(result.cardUnpaid, 0)
})

// I-3 口座引落の積立投資と、今月すでに投資した額の二重計上
function investment(due: string) {
  return payment({
    id: 'pay-1',
    name: '積立NISA',
    category: '投資',
    resolvedDueDate: due,
    amount: 33000,
    resolvedAmountYen: 33000,
  })
}

test('積立：投資カテゴリの予定支払いは computeObligations では数えず、投資の控除へ回す', () => {
  const result = obligations({
    today: '2026-11-14',
    oldestBalanceDate: '2026-11-09',
    scheduled: [investment('2026-11-10')],
  })
  assert.equal(result.fixedUnpaid + result.scheduledUnpaid, 0)
  assert.deepEqual(result.investmentPayments, [
    { id: 'pay-1', due: '2026-11-10', amount: 33000, debitAccountId: null, funding: 'account' },
  ])
})

// F11 残高に反映済みの買付を「今月すでに投資した額」として二重に差し引かない
const buy = (trade_date: string, amount: number, trade_type = '買付') => ({ trade_date, trade_type, amount })

test('投資済み額：記録11/20・買付11/15(5万)と11/22(3万) → 3万だけ', () => {
  const result = sumInvestedAfterBalance([buy('2026-11-15', 50000), buy('2026-11-22', 30000)], {
    month: '2026-11',
    balanceOldestRecordedAt: '2026-11-20',
  })
  assert.equal(result, 30000)
})

test('投資済み額：記録と同じ日の買付は差し引く（安全側）', () => {
  const result = sumInvestedAfterBalance([buy('2026-11-20', 50000)], {
    month: '2026-11',
    balanceOldestRecordedAt: '2026-11-20',
  })
  assert.equal(result, 50000)
})

test('投資済み額：売却・分配金は対象外、当月外の買付も対象外', () => {
  const result = sumInvestedAfterBalance(
    [buy('2026-11-22', 9000, 'sell'), buy('2026-11-22', 100, '分配金'), buy('2026-12-01', 7000), buy('2026-11-22', 30000, 'buy')],
    { month: '2026-11', balanceOldestRecordedAt: '2026-11-20' }
  )
  assert.equal(result, 30000)
  assert.equal(isBuyTradeType('売却'), false)
  assert.equal(isBuyTradeType('積立'), true)
})

test('投資済み額：記録時刻はUTCで前日でも日本時間の日付で比べる', () => {
  // 2026-11-19T16:00:00Z = 日本時間 11/20 01:00。11/20の買付は同日なので差し引く
  const result = sumInvestedAfterBalance([buy('2026-11-20', 4000), buy('2026-11-19', 1000)], {
    month: '2026-11',
    balanceOldestRecordedAt: '2026-11-19T16:00:00Z',
  })
  assert.equal(result, 4000)
})

test('投資済み額：記録日時が不明なら null（0円で埋めない）', () => {
  assert.equal(
    sumInvestedAfterBalance([buy('2026-11-22', 30000)], { month: '2026-11', balanceOldestRecordedAt: null }),
    null
  )
})

// I-1 積立の予定支払いと買付の明示的な対応づけ
const A = 'acct-a'
const B = 'acct-b'
function outflows(
  balances: Record<string, string>,
  payments: { id?: string; due: string; amount?: number; acct?: string | null }[],
  buys: { trade_date: string; amount: number }[],
  oldest = '2026-11-05'
) {
  return computeInvestmentOutflows({
    today: '2026-11-14',
    month: '2026-11',
    payments: payments.map((p, i) => ({
      id: p.id ?? `p${i}`,
      due: p.due,
      amount: p.amount ?? 30000,
      debitAccountId: p.acct === undefined ? A : p.acct,
    })),
    buys,
    balanceDateByAccount: new Map(Object.entries(balances)),
    oldestBalanceDate: oldest,
  })
}
const total = (r: ReturnType<typeof outflows>) => (r ? r.scheduledDeduction + r.buyDeduction : null)

test('積立(a)：口座A 11/12・B 11/05・引落11/10(A)・買付11/10 → 反映済みなので0', () => {
  const r = outflows({ [A]: '2026-11-12', [B]: '2026-11-05' }, [{ due: '2026-11-10' }], [{ trade_date: '2026-11-10', amount: 30000 }])
  assert.equal(total(r), 0)
  assert.deepEqual(r?.pairs, [{ paymentId: 'p0', buyDate: '2026-11-10' }])
})

test('積立(b)：口座Aが11/09なら30,000を1回だけ', () => {
  const r = outflows({ [A]: '2026-11-09', [B]: '2026-11-05' }, [{ due: '2026-11-10' }], [{ trade_date: '2026-11-10', amount: 30000 }])
  assert.equal(total(r), 30000)
})

test('積立(c)：買付11/11・引落11/13(A 11/12)は対応づけて30,000を1回だけ（60,000にしない）', () => {
  const r = outflows({ [A]: '2026-11-12', [B]: '2026-11-05' }, [{ due: '2026-11-13' }], [{ trade_date: '2026-11-11', amount: 30000 }])
  assert.equal(total(r), 30000)
})

test('積立(d)：対応のない買付は最も古い記録日以降なら差し引き、前なら差し引かない', () => {
  const buys = (d: string) => [{ trade_date: d, amount: 12000 }]
  assert.equal(total(outflows({ [A]: '2026-11-05' }, [], buys('2026-11-06'))), 12000)
  assert.equal(total(outflows({ [A]: '2026-11-05' }, [], buys('2026-11-04'))), 0)
})

test('積立(e)：今日より後（11/20）の未実行の予定支払いも差し引く', () => {
  const r = outflows({ [A]: '2026-11-09' }, [{ due: '2026-11-20' }], [])
  assert.equal(r?.scheduledDeduction, 30000)
  assert.deepEqual(r?.pairs, [{ paymentId: 'p0', buyDate: null }])
})

test('積立(f)：最も古い記録日が不明なら null', () => {
  assert.equal(outflows({}, [{ due: '2026-11-10' }], [], null as unknown as string), null)
})

test('積立(g)：2件の予定と2件の買付は日付の近い順に1対1で対応づける', () => {
  const r = outflows(
    { [A]: '2026-11-01' },
    [{ id: 'x', due: '2026-11-10', amount: 10000 }, { id: 'y', due: '2026-11-12', amount: 20000 }],
    [{ trade_date: '2026-11-11', amount: 20000 }, { trade_date: '2026-11-10', amount: 10000 }],
    '2026-11-01'
  )
  assert.deepEqual(r?.pairs, [
    { paymentId: 'x', buyDate: '2026-11-10' },
    { paymentId: 'y', buyDate: '2026-11-11' },
  ])
  assert.equal(total(r), 30000)
})

test('積立：4日以上離れた買付とは対応づけない（予定も買付も別々に差し引く）', () => {
  const r = outflows({ [A]: '2026-11-01' }, [{ due: '2026-11-05' }], [{ trade_date: '2026-11-09', amount: 8000 }], '2026-11-01')
  assert.equal(r?.scheduledDeduction, 30000)
  assert.equal(r?.buyDeduction, 8000)
})

test('積立：引落口座が不明な予定は最も古い記録日で判定する', () => {
  assert.equal(total(outflows({ [A]: '2026-11-12' }, [{ due: '2026-11-08', acct: null }], [], '2026-11-05')), 30000)
  assert.equal(total(outflows({ [A]: '2026-11-12' }, [{ due: '2026-11-04', acct: null }], [], '2026-11-05')), 0)
})

function capacityInput(overrides: Partial<CapacityInput>): CapacityInput {
  return {
    month: '2026-11',
    availableCash: 500000,
    expectedIncome: 0,
    confirmedIncome: 0,
    confirmedExpenses: 0,
    pendingCardAmount: 0,
    fixedExpenses: 0,
    scheduledExpenses: 0,
    livingReserve: 0,
    buffer: 0,
    alreadyInvested: 0,
    investmentDeducted: 0,
    requiredReserve: 0,
    savingsTarget: 0,
    investmentTarget: 0,
    missingData: [],
    balanceOldestRecordedAt: '2026-11-13T00:00:00Z',
    balanceAccounts: [],
    now: new Date('2026-11-14T00:00:00Z'),
    ...overrides,
  }
}

test('記録日時が不明なら投資可能額は null で、信頼度は low、missing_dataが残る', () => {
  const result = computeInvestmentCapacity(
    capacityInput({
      availableCash: null,
      balanceOldestRecordedAt: null,
      missingData: ['口座残高の記録日時が不明なため、投資済み額を判定できません'],
    })
  )
  assert.equal(result.investable_amount, null)
  assert.equal(result.confidence, 'low')
  assert.ok(result.missing_data.includes('口座残高の記録日時が不明なため、投資済み額を判定できません'))
})

test('記録日時が不明：already_invested は当月の買付総額のまま、already_invested_deducted は null', () => {
  const result = computeInvestmentCapacity(
    capacityInput({
      availableCash: null,
      balanceOldestRecordedAt: null,
      alreadyInvested: 45000,
      investmentDeducted: null,
      missingData: ['口座残高の記録日時が不明なため、投資済み額を判定できません'],
    })
  )
  assert.equal(result.already_invested, 45000)
  assert.equal(result.already_invested_deducted, null)
  assert.equal(result.investable_amount, null)
  assert.ok(result.missing_data.includes('口座残高の記録日時が不明なため、投資済み額を判定できません'))
})

test('投資の控除は investmentDeducted を1回だけ引く（alreadyInvested は表示用）', () => {
  const withDeducted = computeInvestmentCapacity(capacityInput({ alreadyInvested: 60000, investmentDeducted: 30000 }))
  assert.equal(withDeducted.investable_amount, 470000)
  assert.equal(withDeducted.already_invested, 60000)
  assert.equal(withDeducted.already_invested_deducted, 30000)
})

// M-2 investmentDeducted は必須（number | null）。残高が分かっていても控除が不明なら投資可能額は null
test('M-2 口座残高があっても投資の控除が不明（null）なら投資可能額は null（0円で埋めない）', () => {
  const result = computeInvestmentCapacity(capacityInput({ alreadyInvested: 60000, investmentDeducted: null }))
  assert.equal(result.available_cash, 500000)
  assert.equal(result.investable_amount, null)
  assert.equal(result.allocatable_cash, null)
  assert.equal(result.already_invested_deducted, null)
  assert.deepEqual(result.allocation, { emergency_fund: null, savings: null, asset_building: null, unallocated_cash: null })
  assert.ok(result.missing_data.includes('投資済み額を判定できないため、投資可能額を算出できません'))
  assert.equal(result.emergency_fund_status, 'unknown')
})

// fix round 2：computeObligations → computeInvestmentOutflows を通しで確認する
function endToEnd(args: {
  balances: Record<string, string>
  payment: Partial<ResolvedScheduledPayment>
  buys: { trade_date: string; amount: number }[]
  today: string
  oldest?: string
  extra?: Partial<Parameters<typeof computeObligations>[0]>
}) {
  const oldest = args.oldest ?? '2026-11-05'
  const balanceDateByAccount = new Map(Object.entries(args.balances))
  const ob = obligations({
    today: args.today,
    oldestBalanceDate: oldest,
    balanceDateByAccount,
    scheduled: [{ ...investment('2026-11-10'), debit_account_id: A, ...args.payment }],
    ...args.extra,
  })
  const out = computeInvestmentOutflows({
    today: args.today,
    month: '2026-11',
    payments: ob.investmentPayments,
    buys: args.buys,
    balanceDateByAccount,
    oldestBalanceDate: oldest,
  })
  return { ob, total: out ? out.scheduledDeduction + out.buyDeduction : null }
}

test('通し(a)：A 11/12・B 11/05・積立11/10(A)・買付11/10 → 投資の控除は0', () => {
  const { ob, total } = endToEnd({
    balances: { [A]: '2026-11-12', [B]: '2026-11-05' },
    payment: {},
    buys: [{ trade_date: '2026-11-10', amount: 30000 }],
    today: '2026-11-14',
  })
  assert.equal(total, 0)
  assert.equal(ob.fixedUnpaid + ob.scheduledUnpaid, 0)
})

test('通し：今月支払い済み（last_paid_month=当月）でも買付は単独で数えない', () => {
  const { total } = endToEnd({
    balances: { [A]: '2026-11-12', [B]: '2026-11-05' },
    payment: { last_paid_month: '2026-11' },
    buys: [{ trade_date: '2026-11-10', amount: 30000 }],
    today: '2026-11-14',
  })
  assert.equal(total, 0)
})

// カード払いの積立：カードの引落日 12/28・引落口座A（記録日 11/09）
const CARD_FUNDED = {
  payment: { payment_method: 'credit_card' as const, credit_card_id: 'card-1', resolvedDueDate: '2026-11-27', debit_account_id: null },
  extra: { cardPaidDebitById: new Map([['pay-1', { date: '2026-12-28', accountId: A }]]) },
}

test('通し：カード払いの積立11/27と買付11/27 → 買付は数えず、予定額をカードの引落として1回だけ差し引く', () => {
  const { ob, total } = endToEnd({
    balances: { [A]: '2026-11-09' },
    ...CARD_FUNDED,
    buys: [{ trade_date: '2026-11-27', amount: 33000 }],
    today: '2026-11-28',
    oldest: '2026-11-09',
  })
  assert.equal(total, 0) // 対応した買付は差し引かない
  assert.equal(ob.cardUnpaid, 33000) // カードの引落（12/28）として1回
  assert.equal(ob.fixedUnpaid + ob.scheduledUnpaid, 0)
})

test('通し：カード払いの積立で買付が無くても、カード利用が取り込まれていなければ予定額を1回差し引く（I-1）', () => {
  const { ob, total } = endToEnd({
    balances: { [A]: '2026-11-09' },
    ...CARD_FUNDED,
    buys: [],
    today: '2026-11-28',
    oldest: '2026-11-09',
  })
  assert.equal(total, 0)
  assert.equal(ob.cardUnpaid, 33000)
  assert.ok(ob.items.some(i => i.kind === 'card' && i.amount === 33000))
})

test('カード払いの積立：対応のない買付は従来どおり数える', () => {
  const r = computeInvestmentOutflows({
    today: '2026-11-28',
    month: '2026-11',
    payments: [{ id: 'c', due: '2026-11-27', amount: 30000, debitAccountId: null, funding: 'card' }],
    buys: [{ trade_date: '2026-11-12', amount: 5000 }],
    balanceDateByAccount: new Map(),
    oldestBalanceDate: '2026-11-09',
  })
  assert.equal(r?.scheduledDeduction, 0)
  assert.equal(r?.buyDeduction, 5000)
})

// ---------------------------------------------------------------- final fix wave（2026-11-24）

// C-1 入金口座が分からない入金（給与・type:income）は最も新しい記録日で判定する
test('C-1 給与：A 11/27・B 11/20・給料日11/25・実績0 → 給与は足さない（新しい口座の残高に反映済み）', () => {
  const salary = salaryIncome({ month: '2026-11', planned: 300000, actual: 0, incomeDay: 25 })
  const result = obligations({
    today: '2026-11-28',
    balanceDateByAccount: new Map([['A', '2026-11-27'], ['B', '2026-11-20']]),
    oldestBalanceDate: '2026-11-20',
    salary,
  })
  assert.equal(result.expectedIncome, 0)
})

test('C-1 給与：A 11/27・B 11/20・給料日11/28 → 30万を足す', () => {
  const salary = salaryIncome({ month: '2026-11', planned: 300000, actual: 0, incomeDay: 28 })
  const result = obligations({
    today: '2026-11-28',
    balanceDateByAccount: new Map([['A', '2026-11-27'], ['B', '2026-11-20']]),
    oldestBalanceDate: '2026-11-20',
    salary,
  })
  assert.equal(result.expectedIncome, 300000)
})

test('C-1 入金予定（type:income・口座不明）も最も新しい記録日で判定し、口座が分かればその口座の記録日', () => {
  const income = (date: string, acct: string | null) =>
    payment({ name: `入金${date}${acct}`, type: 'income', category: '副業', resolvedDueDate: date, resolvedAmountYen: 10000, debit_account_id: acct })
  const result = obligations({
    today: '2026-11-28',
    balanceDateByAccount: new Map([['A', '2026-11-27'], ['B', '2026-11-20']]),
    oldestBalanceDate: '2026-11-20',
    scheduled: [income('2026-11-25', null), income('2026-11-25', 'B'), income('2026-11-28', null)],
  })
  // 11/25 口座不明 → 新しい 11/27 で判定（足さない）、11/25 口座B → 11/20 より後（足す）、11/28 口座不明 → 足す
  assert.equal(result.expectedIncome, 20000)
})

// I-2 last_paid_month だけでは差し引きをやめない。日付の規則（引落日 < その口座の記録日）だけで判定する
test('I-2 口座Bの固定費11/27を支払い済みにしても、Bの記録日が11/20なら差し引く', () => {
  const result = obligations({
    today: '2026-11-28',
    balanceDateByAccount: new Map([['B', '2026-11-20']]),
    oldestBalanceDate: '2026-11-20',
    scheduled: [payment({ name: '家賃', debit_account_id: 'B', last_paid_month: '2026-11', resolvedAmountYen: 80000 })],
  })
  assert.equal(result.fixedUnpaid, 80000)
})

test('I-2 口座Bの記録日が11/28なら（11/27の引落は反映済み）差し引かない', () => {
  const result = obligations({
    today: '2026-11-28',
    balanceDateByAccount: new Map([['B', '2026-11-28']]),
    oldestBalanceDate: '2026-11-28',
    scheduled: [payment({ name: '家賃', debit_account_id: 'B', last_paid_month: '2026-11', resolvedAmountYen: 80000 })],
  })
  assert.equal(result.fixedUnpaid, 0)
})

test('I-2 確定請求も last_paid_month だけでは除かない（記録日より後の引落は差し引く）', () => {
  const result = obligations({
    oldestBalanceDate: '2026-11-23',
    scheduled: [statement({ last_paid_month: '2026-11' })], // 11/27 ≥ 11/23
  })
  assert.equal(result.cardUnpaid, 80000)
})

// I-1 カード払いの費用：取り込み済みのカード利用と照合できたもの・確定請求のあるサイクルに入るものだけ除く。
// それ以外はカードの引落日・引落口座の記録日で1回だけ差し引く
const NETFLIX = payment({
  id: 'netflix',
  name: 'Netflix',
  category: '通信費',
  payment_method: 'credit_card',
  credit_card_id: 'card-1',
  resolvedDueDate: '2026-11-29',
  amount: 1590,
  resolvedAmountYen: 1590,
})
const cardPaidCase = (overrides: Partial<Parameters<typeof computeObligations>[0]>) =>
  obligations({
    today: '2026-11-28',
    balanceDateByAccount: new Map([['A', '2026-11-27']]),
    oldestBalanceDate: '2026-11-27',
    scheduled: [NETFLIX],
    cardPaidDebitById: new Map([['netflix', { date: '2027-01-12', accountId: 'A' }]]),
    ...overrides,
  })

test('I-1 Netflix ¥1,590（カード払い・11/29・未請求）→ カードの引落として1回差し引く', () => {
  const result = cardPaidCase({})
  assert.equal(result.cardUnpaid, 1590)
  assert.equal(result.fixedUnpaid + result.scheduledUnpaid, 0)
  assert.equal(result.items.filter(i => i.kind === 'card').length, 1)
})

test('I-1 Netflix がカード利用と照合済み → サイクルに入っているので追加では差し引かない', () => {
  const result = cardPaidCase({
    matchedFixedCostIds: new Set(['netflix']),
    cardCycles: [cycle({ cardId: 'card-1', paymentDate: '2027-01-12', open: true, amount: 1590, debitAccountId: 'A' })],
  })
  assert.equal(result.cardUnpaid, 1590) // サイクルの1回だけ（3,180にしない）
})

test('I-1 確定請求のあるサイクルに入るカード払いの費用は追加で差し引かない', () => {
  const result = cardPaidCase({ suppressedCardDebitKeys: new Set(['netflix|2027-01-12']) })
  assert.equal(result.cardUnpaid, 0)
})

test('I-1 カードの引落日が引落口座の記録日より前なら残高に反映済み', () => {
  const result = cardPaidCase({ cardPaidDebitById: new Map([['netflix', { date: '2026-11-26', accountId: 'A' }]]) })
  assert.equal(result.cardUnpaid, 0)
})

const RAKUTEN_FUNDED = payment({
  id: 'rakuten-tsumitate',
  name: '楽天カード積立',
  category: '投資',
  payment_method: 'credit_card',
  credit_card_id: 'rakuten',
  resolvedDueDate: '2026-11-01',
  amount: 50000,
  resolvedAmountYen: 50000,
})

test('I-1 楽天カード積立 ¥50,000（カード利用は未取込）→ 1回差し引く。対応した買付は差し引かない', () => {
  const balanceDateByAccount = new Map([['B', '2026-11-20']])
  const ob = obligations({
    today: '2026-11-28',
    balanceDateByAccount,
    oldestBalanceDate: '2026-11-20',
    scheduled: [RAKUTEN_FUNDED],
    cardPaidDebitById: new Map([['rakuten-tsumitate', { date: '2026-12-28', accountId: 'B' }]]),
  })
  const out = computeInvestmentOutflows({
    today: '2026-11-28',
    month: '2026-11',
    payments: ob.investmentPayments,
    buys: [{ trade_date: '2026-11-01', amount: 50000 }],
    balanceDateByAccount,
    oldestBalanceDate: '2026-11-20',
  })
  assert.equal(ob.cardUnpaid, 50000)
  assert.equal(out?.scheduledDeduction, 0)
  assert.equal(out?.buyDeduction, 0)
  assert.deepEqual(out?.pairs, [{ paymentId: 'rakuten-tsumitate', buyDate: '2026-11-01' }])
})

test('I-1 楽天カード積立がカード利用と照合済み → 追加では差し引かない', () => {
  const ob = obligations({
    today: '2026-11-28',
    balanceDateByAccount: new Map([['B', '2026-11-20']]),
    oldestBalanceDate: '2026-11-20',
    scheduled: [RAKUTEN_FUNDED],
    matchedFixedCostIds: new Set(['rakuten-tsumitate']),
    cardPaidDebitById: new Map([['rakuten-tsumitate', { date: '2026-12-28', accountId: 'B' }]]),
  })
  assert.equal(ob.cardUnpaid, 0)
  assert.equal(ob.investmentPayments[0]?.funding, 'card')
})
