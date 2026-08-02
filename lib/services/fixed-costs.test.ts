import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isActiveInMonth,
  resolveAmountYen,
  resolveDueDate,
  resolveMonthlyDebits,
  toDebitSources,
  resolveVariableAmount,
} from './fixed-costs'
import type { CreditCardSetting, ScheduledPayment } from '@/types/cashflow'

function payment(overrides: Partial<ScheduledPayment> = {}): ScheduledPayment {
  return {
    id: 'sp-1',
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

function card(overrides: Partial<CreditCardSetting> = {}): CreditCardSetting {
  return {
    id: 'card-1',
    name: '楽天カード',
    closing_day: '31',
    payment_day: '27',
    closing_day_int: 31,
    payment_day_int: 27,
    payment_month_offset: 1,
    card_plan: 'rakuten_standard',
    debit_account_id: 'acc-rakuten',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------- 営業日補正

test('営業日補正: 26日が土曜なら翌営業日の月曜へずれる', () => {
  // 2026-09-26 は土曜日
  const rent = payment({ business_day_rule: 'next' })
  assert.equal(resolveDueDate(rent, '2026-09'), '2026-09-28')
})

test('営業日補正なし(既定)なら26日のまま動かない', () => {
  const rent = payment() // business_day_rule 未設定 = 'none'
  assert.equal(resolveDueDate(rent, '2026-09'), '2026-09-26')
})

test('営業日補正: previous なら前営業日の金曜へずれる', () => {
  const rent = payment({ business_day_rule: 'previous' })
  assert.equal(resolveDueDate(rent, '2026-09'), '2026-09-25')
})

test('営業日補正: 平日ならそのまま', () => {
  // 2026-07-26 は日曜 → 27日(月)
  const rent = payment({ business_day_rule: 'next' })
  assert.equal(resolveDueDate(rent, '2026-07'), '2026-07-27')
  // 2026-08-26 は水曜 → 動かない
  assert.equal(resolveDueDate(rent, '2026-08'), '2026-08-26')
})

// ---------------------------------------------------------------- 月末クランプ

test('due_day=31 は2月には無いので月末に丸める', () => {
  const p = payment({ due_day: 31 })
  assert.equal(resolveDueDate(p, '2026-02'), '2026-02-28')
  assert.equal(resolveDueDate(p, '2028-02'), '2028-02-29') // 閏年
})

// ---------------------------------------------------------------- 契約期間

test('契約終了後の月は請求が発生しない', () => {
  const p = payment({ end_date: '2026-06-30' })
  assert.equal(resolveDueDate(p, '2026-06'), '2026-06-26')
  assert.equal(resolveDueDate(p, '2026-07'), null)
})

test('契約開始前の月は請求が発生しない', () => {
  const p = payment({ start_date: '2026-08-01' })
  assert.equal(resolveDueDate(p, '2026-07'), null)
  assert.equal(resolveDueDate(p, '2026-08'), '2026-08-26')
})

test('年払いは基準月にだけ発生する', () => {
  const p = payment({ recurrence: 'yearly', start_date: '2026-04-10', due_day: 10 })
  assert.equal(isActiveInMonth(p, '2027-04'), true)
  assert.equal(isActiveInMonth(p, '2026-07'), false)
})

// ---------------------------------------------------------------- 外貨換算

test('105 USD はレート150で15,750円に換算される', () => {
  const gib = payment({
    name: 'ジブラルタ生命',
    amount: 0,
    currency: 'USD',
    foreign_amount: 105,
  })
  assert.equal(resolveAmountYen(gib, { USDJPY: 150 }), 15750)
})

test('外貨のレートが無い場合でも0円にはせずフォールバックする', () => {
  const gib = payment({ amount: 0, currency: 'USD', foreign_amount: 105 })
  // 0円だとキャッシュフローを実態より楽観的に見せてしまうため
  assert.equal(resolveAmountYen(gib, {}), 15750)
})

test('円建てはそのまま整数円', () => {
  assert.equal(resolveAmountYen(payment(), { USDJPY: 150 }), 58330)
})

// ---------------------------------------------------------------- 口座への割当

test('口座引落の固定費は自分の引落口座に割り当たる', () => {
  const rent = payment({ debit_account_id: 'acc-smbc', business_day_rule: 'next' })
  const [debit] = resolveMonthlyDebits([rent], [], '2026-08')

  assert.equal(debit.accountId, 'acc-smbc')
  assert.equal(debit.amount, 58330)
  assert.equal(debit.date, '2026-08-26')
})

test('カード払いの固定費は銀行引落を生まず、カードの支払日・カードの引落口座に付け替わる', () => {
  // 楽天モバイル 3,890円 を楽天カード払いで登録
  const mobile = payment({
    id: 'sp-mobile',
    name: '楽天モバイル',
    amount: 3890,
    due_day: 4,
    payment_method: 'credit_card',
    credit_card_id: 'card-1',
    debit_account_id: 'acc-smbc', // これは無視され、カードの口座が使われる
  })

  const debits = resolveMonthlyDebits([mobile], [card()], '2026-08')
  assert.equal(debits.length, 1, '銀行引落と二重に出てはいけない')

  const [debit] = debits
  // 楽天カード: 月末締め / 翌月27日払い → 8月利用は9月27日
  assert.equal(debit.date.slice(0, 7), '2026-09')
  assert.equal(debit.accountId, 'acc-rakuten', 'カードの引落口座から落ちる')
  assert.equal(debit.viaCardName, '楽天カード')
})

test('現金払いの固定費は口座残高に影響しないので引き落としに含めない', () => {
  const p = payment({ payment_method: 'cash' })
  assert.deepEqual(resolveMonthlyDebits([p], [], '2026-08'), [])
})

test('金額未登録(0円)の固定費は予測に含めない', () => {
  // Apple Music のように金額が未確定のもの
  const p = payment({ name: 'Apple Music', amount: 0 })
  assert.deepEqual(resolveMonthlyDebits([p], [], '2026-08'), [])
})

test('無効(is_active=false)な固定費は含めない', () => {
  assert.deepEqual(resolveMonthlyDebits([payment({ is_active: false })], [], '2026-08'), [])
})

test('引落口座が未設定なら accountId は null(「引落口座 未確認」)', () => {
  const water = payment({ name: '水道', amount: 3200, debit_account_id: null })
  const [debit] = resolveMonthlyDebits([water], [], '2026-08')
  assert.equal(debit.accountId, null)
})

// ---------------------------------------------------------------- コーチへの受け渡し

test('toDebitSources は前月利用ぶんのカード引き落としも当月に拾う', () => {
  const mobile = payment({
    id: 'sp-mobile',
    name: '楽天モバイル',
    amount: 3890,
    due_day: 4,
    payment_method: 'credit_card',
    credit_card_id: 'card-1',
  })

  // 2026-09-20 時点。8月利用ぶんが 9月27日に落ちる
  const sources = toDebitSources([mobile], [card()], '2026-09-20')
  const september = sources.filter(s => s.scheduled_date?.startsWith('2026-09'))

  assert.equal(september.length, 1)
  // 楽天カードの支払日27日は 2026-09-27 が日曜なので翌営業日の28日(月)になる
  assert.equal(september[0].scheduled_date, '2026-09-28')
  assert.equal(september[0].debit_account_id, 'acc-rakuten')
  assert.match(september[0].name, /楽天カード/)
})

// ---------------------------------------------------------------- 変動固定費の金額

test('確定額があれば予定額より優先し、両者を足さない', () => {
  const result = resolveVariableAmount(
    { amount: 2000, amount_type: 'variable' },
    '2026-08',
    3150
  )
  assert.deepEqual(result, { amount: 3150, basis: 'confirmed' })
})

test('確定額が無ければユーザー入力の予定額を使う', () => {
  const result = resolveVariableAmount({ amount: 2000, amount_type: 'variable' }, '2026-08')
  assert.deepEqual(result, { amount: 2000, basis: 'planned' })
})

test('予定額が未登録なら直近3ヶ月の確定実績の平均を使う', () => {
  const history = new Map([
    ['2026-07', 3000],
    ['2026-06', 2000],
    ['2026-05', 1000],
    ['2026-04', 999999], // 3ヶ月より前は使わない
  ])
  const result = resolveVariableAmount(
    { amount: 0, amount_type: 'variable' },
    '2026-08',
    undefined,
    history
  )
  assert.deepEqual(result, { amount: 2000, basis: 'average', sampleMonths: 3 })
})

test('履歴が1〜2ヶ月ぶんしか無ければ、その月数だけで平均する', () => {
  const history = new Map([['2026-07', 3000], ['2026-06', 2000]])
  const result = resolveVariableAmount(
    { amount: 0, amount_type: 'variable' },
    '2026-08',
    undefined,
    history
  )
  // 0円の月で薄めず 2件で平均する
  assert.deepEqual(result, { amount: 2500, basis: 'average', sampleMonths: 2 })
})

test('確定も予定も履歴も無ければ 0円ではなく unknown として警告に回す', () => {
  const result = resolveVariableAmount({ amount: 0, amount_type: 'variable' }, '2026-08')
  assert.equal(result.basis, 'unknown')
})

test('固定額は予定額がそのまま請求額になる', () => {
  const result = resolveVariableAmount({ amount: 58330, amount_type: 'fixed' }, '2026-08')
  assert.deepEqual(result, { amount: 58330, basis: 'planned' })
})

test('固定額でも、確定額が取れたらそちらを使う', () => {
  const result = resolveVariableAmount({ amount: 3980, amount_type: 'fixed' }, '2026-07', 2007)
  assert.deepEqual(result, { amount: 2007, basis: 'confirmed' })
})
