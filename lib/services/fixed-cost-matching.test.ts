import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  confirmedAmountsByMonth,
  findUnmatchedCardFixedCosts,
  matchFixedCostsToCardUsage,
  suppressedByConfirmedCycles,
  suppressedDebitKeys,
} from './fixed-cost-matching'
import { projectCashflow } from '@/lib/cashflow'
import type { CreditCardSetting, ScheduledPayment } from '@/types/cashflow'
import type { Transaction } from '@/types/transaction'

const rakuten: CreditCardSetting = {
  id: 'card-rakuten',
  name: '楽天カード',
  closing_day: '31',
  payment_day: '27',
  closing_day_int: 31,
  payment_day_int: 27,
  payment_month_offset: 1,
  created_at: '2026-01-01T00:00:00Z',
}

function fixed(overrides: Partial<ScheduledPayment> = {}): ScheduledPayment {
  return {
    id: 'sp-mobile',
    name: '楽天モバイル',
    amount: 3980,
    due_day: 11,
    category: '通信費',
    type: 'fixed',
    is_active: true,
    payment_method: 'credit_card',
    credit_card_id: 'card-rakuten',
    match_keywords: ['楽天モバイル', 'RAKUTEN MOBILE'],
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    date: '2026-07-11',
    amount: 2007,
    category: '通信費',
    payment_method: 'クレジットカード',
    memo: 'クレジットカード自動連携 (: 楽天モバイル通信料)',
    source: 'gmail',
    kind: 'expense',
    card_issuer: '楽天カード',
    created_at: '2026-07-11T00:00:00Z',
    updated_at: '2026-07-11T00:00:00Z',
    ...overrides,
  }
}

test('キーワード一致した実取引が、その固定費の締めサイクルに紐づく', () => {
  const matches = matchFixedCostsToCardUsage([fixed()], [rakuten], [tx()])

  assert.equal(matches.length, 1)
  assert.equal(matches[0].paymentName, '楽天モバイル')
  assert.equal(matches[0].amount, 2007)   // 予定額3,980ではなく実額
  assert.equal(matches[0].month, '2026-07')
  assert.equal(matches[0].paymentDate, '2026-08-27') // 7月利用 → 8/27引き落とし
})

test('半角カタカナ・記号の揺れを吸収して照合する', () => {
  const water = fixed({
    id: 'sp-water',
    name: '水道代',
    match_keywords: ['スイドウリ'],
  })
  const matches = matchFixedCostsToCardUsage(
    [water],
    [rakuten],
    [tx({ id: 'tx-w', amount: 1232, memo: 'クレジットカード自動連携 (: 26/06-26/07ｽｲﾄﾞｳﾘ)' })]
  )
  assert.equal(matches.length, 1)
  assert.equal(matches[0].amount, 1232)
})

test('キーワード未設定の固定費は照合されず、警告対象として返る', () => {
  const noKeywords = fixed({ id: 'sp-gas', name: 'ガス代', match_keywords: [] })

  assert.equal(matchFixedCostsToCardUsage([noKeywords], [rakuten], [tx()]).length, 0)
  assert.deepEqual(
    findUnmatchedCardFixedCosts([noKeywords]).map(p => p.name),
    ['ガス代']
  )
})

test('別のカードの利用は照合しない', () => {
  const matches = matchFixedCostsToCardUsage(
    [fixed()],
    [rakuten],
    [tx({ card_issuer: '三井住友カード' })]
  )
  assert.equal(matches.length, 0)
})

test('同じサイクル内の複数取引は合算される', () => {
  const matches = matchFixedCostsToCardUsage(
    [fixed()],
    [rakuten],
    [tx({ id: 'a', amount: 2007 }), tx({ id: 'b', date: '2026-07-25', amount: 500 })]
  )
  assert.equal(matches.length, 1)
  assert.equal(matches[0].amount, 2507)
})

test('確定額は 固定費ID|利用月 で引ける', () => {
  const index = confirmedAmountsByMonth(matchFixedCostsToCardUsage([fixed()], [rakuten], [tx()]))
  assert.equal(index.get('sp-mobile|2026-07'), 2007)
})

// ここが本命。実データで月31,000円ぶん多く引かれていた事故の再現防止。
test('実カード利用と照合できた固定費は、予測から二重に引かれない', () => {
  const payment = fixed()
  const matches = matchFixedCostsToCardUsage([payment], [rakuten], [tx()])

  const withoutSuppression = projectCashflow(1_000_000, [payment], 40, {
    today: new Date(2026, 7, 1), // 2026-08-01
    creditCards: [rakuten],
  })
  const withSuppression = projectCashflow(1_000_000, [payment], 40, {
    today: new Date(2026, 7, 1),
    creditCards: [rakuten],
    suppressedDebits: suppressedDebitKeys(matches),
  })

  const debitDay = (days: ReturnType<typeof projectCashflow>) =>
    days.find(d => d.date === '2026-08-27')

  // 抑制しないと 7月利用ぶんの予測 3,980円 が 8/27 に乗る
  assert.equal(debitDay(withoutSuppression)?.payments.length, 1)
  assert.equal(debitDay(withoutSuppression)?.payments[0].amount, 3980)

  // 抑制すると乗らない（実額はカード請求側で既に引かれているため）
  assert.equal(debitDay(withSuppression)?.payments.length, 0)
  assert.equal(withSuppression.at(-1)?.balance, 1_000_000)
})

test('照合できていないサイクルの予測は残る', () => {
  const payment = fixed()
  // 7月の実取引しか無いので、8月利用ぶん(9/28引き落とし)の予測は残る
  const matches = matchFixedCostsToCardUsage([payment], [rakuten], [tx()])
  const days = projectCashflow(1_000_000, [payment], 70, {
    today: new Date(2026, 7, 1),
    creditCards: [rakuten],
    suppressedDebits: suppressedDebitKeys(matches),
  })
  // 9/27は日曜なので翌営業日の28日
  assert.equal(days.find(d => d.date === '2026-09-28')?.payments.length, 1)
})

// 電力・ガスの摘要は表記ゆれが大きい。半角カタカナ・拗音の大書き・英字のいずれでも拾う
test('アルカナエナジーと東京ガスは表記ゆれがあっても照合できる', () => {
  const smbc: CreditCardSetting = { ...rakuten, id: 'card-smbc', name: '三井住友カード' }
  const electric = fixed({
    id: 'sp-electric', name: '電気代', credit_card_id: 'card-smbc',
    match_keywords: ['アルカナエナジー', 'アルカナ', 'ARCANA'],
  })
  const gas = fixed({
    id: 'sp-gas', name: 'ガス代', credit_card_id: 'card-smbc',
    match_keywords: ['東京ガス', 'トウキヨウガス', 'トウキョウガス', 'TOKYO GAS'],
  })

  const variants: Array<[string, string]> = [
    ['sp-electric', 'クレジットカード自動連携 (ｱﾙｶﾅｴﾅｼﾞｰ)'],       // 半角カタカナ
    ['sp-electric', 'クレジットカード自動連携 (アルカナエナジー)'],
    ['sp-electric', 'クレジットカード自動連携 (ARCANA ENERGY)'],     // 英字
    ['sp-gas', 'クレジットカード自動連携 (東京ガス)'],              // 漢字
    ['sp-gas', 'クレジットカード自動連携 (ﾄｳｷﾖｳｶﾞｽ)'],              // 半角・拗音大書き
    ['sp-gas', 'クレジットカード自動連携 (TOKYO GAS)'],
  ]

  for (const [expectedId, memo] of variants) {
    const matches = matchFixedCostsToCardUsage(
      [electric, gas],
      [smbc],
      [tx({ id: 'tx-x', memo, card_issuer: '三井住友カード' })]
    )
    assert.equal(matches.length, 1, `照合できなかった: ${memo}`)
    assert.equal(matches[0].paymentId, expectedId, `別の固定費に紐づいた: ${memo}`)
  }
})

test('「ガス」を含む無関係な店名は誤照合しない', () => {
  const smbc: CreditCardSetting = { ...rakuten, id: 'card-smbc', name: '三井住友カード' }
  const gas = fixed({
    id: 'sp-gas', name: 'ガス代', credit_card_id: 'card-smbc',
    match_keywords: ['東京ガス', 'トウキヨウガス', 'トウキョウガス', 'TOKYO GAS'],
  })
  const matches = matchFixedCostsToCardUsage(
    [gas],
    [smbc],
    [tx({ id: 'tx-y', memo: 'クレジットカード自動連携 (ガスト 笹塚店)', card_issuer: '三井住友カード' })]
  )
  assert.equal(matches.length, 0)
})

// 確定請求額はそのサイクルの総額。電気代・ガス代も中に含まれているので、
// 固定費の予測を足すと二重計上になる。
test('確定額があるサイクルでは、カード払い固定費の予測を足さない', () => {
  const smbc: CreditCardSetting = { ...rakuten, id: 'card-smbc', name: '三井住友カード' }
  // 照合キーワードが無い＝実取引と個別に消し込めない固定費
  const electric = fixed({
    id: 'sp-electric', name: '電気代', amount: 2000, due_day: 1,
    credit_card_id: 'card-smbc', match_keywords: [],
  })

  const confirmed = new Set(['card-smbc|2026-08-27'])
  const suppressed = suppressedByConfirmedCycles([electric], [smbc], confirmed, ['2026-07'])

  // 7月利用ぶんは 8/27 引き落とし → 確定額があるので取り下げる
  assert.deepEqual([...suppressed], ['sp-electric|2026-08-27'])
})

test('確定額が無いサイクルの予測は残す（メール由来の実績は取りこぼしがあるため）', () => {
  const smbc: CreditCardSetting = { ...rakuten, id: 'card-smbc', name: '三井住友カード' }
  const electric = fixed({
    id: 'sp-electric', name: '電気代', amount: 2000, due_day: 1,
    credit_card_id: 'card-smbc', match_keywords: [],
  })

  assert.equal(
    suppressedByConfirmedCycles([electric], [smbc], new Set(), ['2026-07']).size,
    0
  )
  // 別のカードの確定額では消えない
  assert.equal(
    suppressedByConfirmedCycles([electric], [smbc], new Set(['card-rakuten|2026-08-27']), ['2026-07']).size,
    0
  )
})

test('口座引落の固定費は確定額の影響を受けない', () => {
  const smbc: CreditCardSetting = { ...rakuten, id: 'card-smbc', name: '三井住友カード' }
  const rent = fixed({
    id: 'sp-rent', name: '家賃', amount: 58330, due_day: 26,
    payment_method: 'bank_debit', credit_card_id: null, match_keywords: [],
  })

  assert.equal(
    suppressedByConfirmedCycles([rent], [smbc], new Set(['card-smbc|2026-08-26']), ['2026-08']).size,
    0
  )
})
