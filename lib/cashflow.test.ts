import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectCashflow } from './cashflow'
import type { CreditCardSetting, ScheduledPayment } from '@/types/cashflow'

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
