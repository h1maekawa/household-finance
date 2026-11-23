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
} from './capacity-obligations'
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

test('今月支払い済み（last_paid_month が当月）の固定費は数えない', () => {
  const result = obligations({
    scheduled: [payment({ last_paid_month: '2026-11', amount: 5000, resolvedAmountYen: 5000 })],
  })
  assert.equal(result.fixedUnpaid, 0)
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
    name: '積立NISA',
    category: '投資',
    resolvedDueDate: due,
    amount: 33000,
    resolvedAmountYen: 33000,
  })
}

test('積立：引落11/10・記録日11/09・今日11/14・11/10の買付あり → 予定は差し引かない', () => {
  const result = obligations({
    today: '2026-11-14',
    oldestBalanceDate: '2026-11-09',
    scheduled: [investment('2026-11-10')],
    investmentBuyDates: ['2026-11-10'],
  })
  assert.equal(result.fixedUnpaid + result.scheduledUnpaid, 0)
})

test('積立：同じ条件で買付が未取込なら差し引く', () => {
  const result = obligations({
    today: '2026-11-14',
    oldestBalanceDate: '2026-11-09',
    scheduled: [investment('2026-11-10')],
    investmentBuyDates: [],
  })
  assert.equal(result.fixedUnpaid + result.scheduledUnpaid, 33000)
})

test('積立：引落が今日より後（11/28）なら買付があっても差し引く', () => {
  const result = obligations({
    today: '2026-11-14',
    oldestBalanceDate: '2026-11-09',
    scheduled: [investment('2026-11-28')],
    investmentBuyDates: ['2026-11-10'],
  })
  assert.equal(result.fixedUnpaid + result.scheduledUnpaid, 33000)
})

test('積立：記録日より前の買付は今回の実行とみなさない', () => {
  const result = obligations({
    today: '2026-11-14',
    oldestBalanceDate: '2026-11-09',
    scheduled: [investment('2026-11-10')],
    investmentBuyDates: ['2026-11-05'],
  })
  assert.equal(result.fixedUnpaid + result.scheduledUnpaid, 33000)
})
