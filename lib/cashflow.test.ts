import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCardCycles,
  findUnassignedCardUsage,
  indexConfirmedStatements,
  projectCashflow,
  resolveCardCycle,
} from './cashflow'
import type { CreditCardSetting, ScheduledPayment } from '@/types/cashflow'
import type { Transaction } from '@/types/transaction'

function payment(overrides: Partial<ScheduledPayment> = {}): ScheduledPayment {
  return {
    id: 'sp-rent',
    name: '家賃',
    amount: 58330,
    due_day: 26,
    category: '住居費',
    type: 'fixed',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** 2026-09-01 起点で 40 日ぶん予測する */
function project(payments: ScheduledPayment[], options = {}) {
  return projectCashflow(1_000_000, payments, 40, {
    today: new Date(2026, 8, 1), // 2026-09-01
    ...options,
  })
}

function dayOf(days: ReturnType<typeof project>, date: string) {
  return days.find(d => d.date === date)
}

test('固定費に営業日補正がかかり、土曜の26日は月曜28日に引き落とされる', () => {
  const days = project([payment({ business_day_rule: 'next' })])

  assert.equal(dayOf(days, '2026-09-26')?.payments.length, 0, '土曜には落ちない')
  assert.equal(dayOf(days, '2026-09-28')?.payments.length, 1, '翌営業日に落ちる')
  assert.equal(dayOf(days, '2026-09-28')?.balance, 1_000_000 - 58330)
})

test('営業日補正なし(既定)なら26日のまま引き落とされる', () => {
  const days = project([payment()])
  assert.equal(dayOf(days, '2026-09-26')?.payments.length, 1)
})

test('契約終了済みの固定費は予測に含まれない', () => {
  const days = project([payment({ end_date: '2026-08-31' })])

  const total = days.at(-1)?.balance
  assert.equal(total, 1_000_000, '残高が減らない')
  assert.equal(days.every(d => d.payments.length === 0), true)
})

test('外貨建て固定費は円換算した額で残高から引かれる', () => {
  const gibraltar = payment({
    id: 'sp-gib',
    name: 'ジブラルタ生命',
    amount: 0,
    due_day: 10,
    currency: 'USD',
    foreign_amount: 105,
  })

  const days = project([gibraltar], { fxRates: { USDJPY: 150 } })
  const day = dayOf(days, '2026-09-10')

  assert.equal(day?.payments[0].amount, 15750, '原資産額(105)ではなく円換算額で表示する')
  assert.equal(day?.balance, 1_000_000 - 15750)
})

test('カード払いの固定費は自分の支払日には落ちず、カードの引き落とし日に回る', () => {
  const mobile = payment({
    id: 'sp-mobile',
    name: '楽天モバイル',
    amount: 3890,
    due_day: 4,
    payment_method: 'credit_card',
    credit_card_id: 'card-1',
  })

  const rakuten: CreditCardSetting = {
    id: 'card-1',
    name: '楽天カード',
    closing_day: '31',
    payment_day: '27',
    closing_day_int: 31,
    payment_day_int: 27,
    payment_month_offset: 1,
    card_plan: 'rakuten_standard',
    created_at: '2026-01-01T00:00:00Z',
  }

  const days = project([mobile], { creditCards: [rakuten] })

  assert.equal(dayOf(days, '2026-09-04')?.payments.length, 0, '利用日には口座から落ちない')
  // 8月利用ぶんが9月27日(日) → 翌営業日の28日に落ちる
  assert.equal(dayOf(days, '2026-09-28')?.payments.length, 1)
})

test('収入の予定は残高を増やす', () => {
  const bonus = payment({
    id: 'sp-bonus',
    name: '賞与',
    amount: 300000,
    due_day: 15,
    type: 'income',
  })

  const days = project([bonus])
  assert.equal(dayOf(days, '2026-09-15')?.balance, 1_300_000)
})

test('scheduled_date が確定している支払いはその日に落ち、補正で動かされない', () => {
  // Gmail 取込などで実日付が確定しているケース
  const confirmed = payment({
    scheduled_date: '2026-09-26', // 土曜だが確定済み
    business_day_rule: 'next',
  })

  const days = project([confirmed])
  assert.equal(dayOf(days, '2026-09-26')?.payments.length, 1)
  assert.equal(dayOf(days, '2026-09-28')?.payments.length, 0)
})

// ---------------------------------------------------------------- カードの取りこぼし

function cardTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    date: '2026-07-07',
    amount: 734,
    category: '日用品',
    payment_method: 'クレジットカード',
    source: 'gmail',
    kind: 'expense',
    card_issuer: null,
    created_at: '2026-07-07T00:00:00Z',
    updated_at: '2026-07-07T00:00:00Z',
    ...overrides,
  }
}

const smbc: CreditCardSetting = {
  id: 'card-smbc',
  name: '三井住友カード',
  closing_day: '31',
  payment_day: '27',
  closing_day_int: 31,
  payment_day_int: 27,
  payment_month_offset: 1,
  created_at: '2026-01-01T00:00:00Z',
}

test('card_issuer が空のカード利用は、どのカードにも紐づかず取りこぼされたと検出される', () => {
  const result = findUnassignedCardUsage(
    [
      cardTx({ id: 'a', amount: 734 }),
      cardTx({ id: 'b', amount: 909, date: '2026-07-08' }),
      cardTx({ id: 'c', amount: 5000, card_issuer: '三井住友カード' }), // 紐づく
      cardTx({ id: 'd', amount: 4220, payment_method: '現金' }),        // カードではない
    ],
    [smbc]
  )

  assert.equal(result.total, 1643)
  assert.equal(result.count, 2)
  assert.deepEqual(result.byMonth, { '2026-07': 1643 })
})

test('カード利用が全て紐づいていれば取りこぼしはゼロ', () => {
  const result = findUnassignedCardUsage([cardTx({ card_issuer: '三井住友カード' })], [smbc])
  assert.equal(result.total, 0)
  assert.equal(result.count, 0)
})

// ---------------------------------------------------------------- 締め前サイクルの可視化

const smbc10th: CreditCardSetting = {
  ...smbc,
  id: 'card-smbc-10',
  closing_day: '15',
  payment_day: '10',
  closing_day_int: 15,
  payment_day_int: 10,
  card_plan: 'smbc_10th',
}

test('SMBC 10日払いは 15日締め・翌月10日払いでサイクルが分かれる', () => {
  const cycle前半 = resolveCardCycle(new Date(2026, 6, 3), smbc10th)   // 7/3 利用
  const cycle後半 = resolveCardCycle(new Date(2026, 6, 20), smbc10th)  // 7/20 利用

  assert.deepEqual(cycle前半, {
    periodStart: '2026-06-16', periodEnd: '2026-07-15', paymentDate: '2026-08-10',
  })
  assert.deepEqual(cycle後半, {
    periodStart: '2026-07-16', periodEnd: '2026-08-15', paymentDate: '2026-09-10',
  })
})

test('プラン未設定カードは締め日設定どおりに 月末締め・翌月27日払いになる', () => {
  // 27日が日曜(2026-09-27)なので翌営業日の28日へシフトする
  assert.deepEqual(resolveCardCycle(new Date(2026, 7, 20), smbc), {
    periodStart: '2026-08-01', periodEnd: '2026-08-31', paymentDate: '2026-09-28',
  })
})

test('締め日が未到来のサイクルは open=true で「まだ増える」と分かる', () => {
  const cycles = buildCardCycles(
    [
      cardTx({ id: 'a', date: '2026-07-03', amount: 1000, card_issuer: '三井住友カード' }),
      cardTx({ id: 'b', date: '2026-07-20', amount: 2000, card_issuer: '三井住友カード' }),
      cardTx({ id: 'c', date: '2026-08-01', amount: 3000, card_issuer: '三井住友カード' }),
    ],
    [smbc10th],
    new Date(2026, 7, 2) // 2026-08-02
  )

  assert.equal(cycles.length, 2)

  // 6/16〜7/15 利用分 → 8/10 引き落とし。締め済みなので金額は確定
  assert.equal(cycles[0].paymentDate, '2026-08-10')
  assert.equal(cycles[0].amount, 1000)
  assert.equal(cycles[0].open, false)

  // 7/16〜8/15 利用分 → 9/10 引き落とし。締め前なのでまだ増える
  assert.equal(cycles[1].paymentDate, '2026-09-10')
  assert.equal(cycles[1].amount, 5000)
  assert.equal(cycles[1].open, true)
  assert.equal(cycles[1].transactionCount, 2)
})

test('引き落とし済みのサイクルは「これから出ていくお金」に含めない', () => {
  const cycles = buildCardCycles(
    [cardTx({ id: 'a', date: '2026-05-10', amount: 9999, card_issuer: '三井住友カード' })],
    [smbc10th],
    new Date(2026, 7, 2) // 6/10 に引き落とし済み
  )
  assert.equal(cycles.length, 0)
})

// ---------------------------------------------------------------- 確定請求額

test('確定請求額はカードID+引き落とし日で突合され、締め済みサイクルに乗る', () => {
  const statements = indexConfirmedStatements([
    payment({
      id: 'stmt-1',
      name: '三井住友カード 請求（確定）',
      amount: 138370,
      source: 'card_statement',
      credit_card_id: 'card-smbc-10',
      scheduled_date: '2026-08-10',
    }),
  ])

  const cycles = buildCardCycles(
    [
      cardTx({ id: 'a', date: '2026-07-03', amount: 1000, card_issuer: '三井住友カード' }),
      cardTx({ id: 'b', date: '2026-07-20', amount: 2000, card_issuer: '三井住友カード' }),
    ],
    [smbc10th],
    new Date(2026, 7, 2),
    statements
  )

  // 8/10 のサイクルは締め済み → 確定額が入る(見込み1,000円との差が実額)
  assert.equal(cycles[0].paymentDate, '2026-08-10')
  assert.equal(cycles[0].amount, 1000)
  assert.equal(cycles[0].confirmedAmount, 138370)

  // 9/10 のサイクルは締め前 → カード会社も未確定なので確定額は持ちえない
  assert.equal(cycles[1].open, true)
  assert.equal(cycles[1].confirmedAmount, null)
})

test('締め前のサイクルには確定額を紐づけない', () => {
  const statements = indexConfirmedStatements([
    payment({
      id: 'stmt-2',
      amount: 99999,
      source: 'card_statement',
      credit_card_id: 'card-smbc-10',
      scheduled_date: '2026-09-10', // 締め前サイクルの支払日
    }),
  ])

  const cycles = buildCardCycles(
    [cardTx({ id: 'a', date: '2026-08-01', amount: 3000, card_issuer: '三井住友カード' })],
    [smbc10th],
    new Date(2026, 7, 2),
    statements
  )

  assert.equal(cycles[0].open, true)
  assert.equal(cycles[0].confirmedAmount, null)
})

test('確定額でない予定は突合インデックスに入らない', () => {
  const index = indexConfirmedStatements([
    payment({ id: 'p1', source: 'manual', credit_card_id: 'c1', scheduled_date: '2026-08-10' }),
    payment({ id: 'p2', source: 'card_statement', credit_card_id: null, scheduled_date: '2026-08-10' }),
  ])
  assert.equal(index.size, 0)
})
