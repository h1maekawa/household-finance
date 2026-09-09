import test from 'node:test'
import assert from 'node:assert/strict'
import { LIQUID_ACCOUNT_TYPES, sumLiquidCash } from './liquid-cash'

const accounts = [
  { id: 'a1', type: 'bank' },
  { id: 'a2', type: 'cash' },
  { id: 'a3', type: 'emoney' },
  { id: 'a4', type: 'securities' },
]

test('流動現金は bank / cash / emoney', () => {
  assert.deepEqual([...LIQUID_ACCOUNT_TYPES], ['bank', 'cash', 'emoney'])
})

test('複数口座の最新残高を合計する', () => {
  const r = sumLiquidCash(accounts, [
    { account_id: 'a1', balance: 300000, recorded_at: '2026-09-01T00:00:00Z' },
    { account_id: 'a2', balance: 20000, recorded_at: '2026-09-02T00:00:00Z' },
    { account_id: 'a3', balance: 5000, recorded_at: '2026-09-03T00:00:00Z' },
  ])
  assert.equal(r.amount, 325000)
  assert.equal(r.accountCount, 3)
  assert.equal(r.recordedAt, '2026-09-03T00:00:00Z')
})

test('証券口座は流動現金に含めない', () => {
  const r = sumLiquidCash(accounts, [
    { account_id: 'a1', balance: 100000, recorded_at: '2026-09-01T00:00:00Z' },
    { account_id: 'a4', balance: 900000, recorded_at: '2026-09-01T00:00:00Z' },
  ])
  assert.equal(r.amount, 100000)
})

test('口座ごとに最新の1件だけを採用する', () => {
  const r = sumLiquidCash([{ id: 'a1', type: 'bank' }], [
    { account_id: 'a1', balance: 100000, recorded_at: '2026-08-01T00:00:00Z' },
    { account_id: 'a1', balance: 250000, recorded_at: '2026-09-05T00:00:00Z' },
  ])
  assert.equal(r.amount, 250000)
})

test('残高が一度も記録されていない口座を0円として数えない', () => {
  // 数えると「残高データがある」と誤判定して実態より少ない現金で計算してしまう
  const r = sumLiquidCash(accounts, [])
  assert.equal(r.amount, null)
  assert.equal(r.recordedAt, null)
})

test('残高が null の行は採用しない', () => {
  const r = sumLiquidCash([{ id: 'a1', type: 'bank' }], [
    { account_id: 'a1', balance: null, recorded_at: '2026-09-05T00:00:00Z' },
  ])
  assert.equal(r.amount, null)
})

test('流動口座が1つも無ければ null', () => {
  const r = sumLiquidCash([{ id: 'a4', type: 'securities' }], [
    { account_id: 'a4', balance: 900000, recorded_at: '2026-09-01T00:00:00Z' },
  ])
  assert.equal(r.amount, null)
  assert.equal(r.accountCount, 0)
})

test('残高0円は「未登録」ではなく0円として扱う', () => {
  const r = sumLiquidCash([{ id: 'a1', type: 'bank' }], [
    { account_id: 'a1', balance: 0, recorded_at: '2026-09-01T00:00:00Z' },
  ])
  assert.equal(r.amount, 0)
})
