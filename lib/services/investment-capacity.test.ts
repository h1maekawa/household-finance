import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BALANCE_STALE_HOURS,
  judgeBalanceFreshness,
  computeInvestmentCapacity,
  type CapacityInput,
} from './investment-capacity'

const now = new Date('2026-11-24T00:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString()

test('鮮度の閾値は168時間', () => {
  assert.equal(BALANCE_STALE_HOURS, 168)
})

test('judgeBalanceFreshness: 167時間前は current', () => {
  const r = judgeBalanceFreshness({ oldestRecordedAt: hoursAgo(167), accountCount: 2, now })
  assert.equal(r.freshness, 'current')
})

test('judgeBalanceFreshness: ちょうど168時間前は current、169時間前は stale', () => {
  assert.equal(judgeBalanceFreshness({ oldestRecordedAt: hoursAgo(168), accountCount: 1, now }).freshness, 'current')
  assert.equal(judgeBalanceFreshness({ oldestRecordedAt: hoursAgo(169), accountCount: 1, now }).freshness, 'stale')
})

test('judgeBalanceFreshness: 記録なし・不正な日時は unknown', () => {
  assert.equal(judgeBalanceFreshness({ oldestRecordedAt: null, accountCount: 1, now }).freshness, 'unknown')
  assert.equal(judgeBalanceFreshness({ oldestRecordedAt: 'not-a-date', accountCount: 1, now }).freshness, 'unknown')
})

test('judgeBalanceFreshness: 口座別の stale を返す', () => {
  const r = judgeBalanceFreshness({
    oldestRecordedAt: hoursAgo(300), accountCount: 2, now,
    accounts: [
      { accountId: 'a', recordedAt: hoursAgo(1) },
      { accountId: 'b', recordedAt: hoursAgo(300) },
    ],
  })
  assert.equal(r.freshness, 'stale')
  assert.deepEqual(r.staleAccountIds, ['b'])
})

function input(over: Partial<CapacityInput> = {}): CapacityInput {
  return {
    month: '2026-11', availableCash: 500000, expectedIncome: 0,
    confirmedIncome: 300000, confirmedExpenses: 0, pendingCardAmount: 0,
    fixedExpenses: 0, scheduledExpenses: 0, livingReserve: 0, buffer: 0,
    alreadyInvested: 0, requiredReserve: 0, missingData: [],
    balanceOldestRecordedAt: hoursAgo(1), now, ...over,
  }
}

test('古い口座があれば stale / low / missing_data、投資可能額は計算して返す', () => {
  const r = computeInvestmentCapacity(input({
    balanceOldestRecordedAt: hoursAgo(400),
    balanceAccounts: [
      { accountId: 'a', recordedAt: hoursAgo(1) },
      { accountId: 'b', recordedAt: hoursAgo(400) },
    ],
  }))
  assert.equal(r.data_freshness, 'stale')
  assert.equal(r.confidence, 'low')
  assert.ok(r.missing_data.includes('7日以上更新されていない口座残高があります'))
  assert.equal(r.investable_amount, 500000)
  assert.equal(r.balance_oldest_recorded_at, hoursAgo(400))
  assert.equal(r.stale_account_count, 1)
})

test('新しい残高なら current で missing_data を増やさない', () => {
  const r = computeInvestmentCapacity(input())
  assert.equal(r.data_freshness, 'current')
  assert.equal(r.confidence, 'high')
  assert.equal(r.stale_account_count, 0)
  assert.deepEqual(r.missing_data, [])
})

test('残高が未登録なら unknown', () => {
  const r = computeInvestmentCapacity(input({ availableCash: null, balanceOldestRecordedAt: null }))
  assert.equal(r.data_freshness, 'unknown')
})
