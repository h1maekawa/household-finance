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
  const r = sumLiquidCash([accounts[0], accounts[3]], [
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

// 変更前は a1 だけの記録でも 100000 を返していた（一部の口座だけで合計）。
// Task 2 で「一部の口座に記録が無ければ合計しない」へ変更した。
test('[変更点] 記録の無い流動口座があれば、記録のある口座だけでは合計しない', () => {
  const r = sumLiquidCash(accounts, [
    { account_id: 'a1', balance: 100000, recorded_at: '2026-09-01T00:00:00Z' },
  ])
  assert.equal(r.amount, null)
})

// --- Task 2: 口座ごとの鮮度 ---
test('最も古い口座の記録時刻を返す（recordedAt は最新のまま）', () => {
  const r = sumLiquidCash(
    [{ id: 'a', type: 'bank' }, { id: 'b', type: 'bank' }],
    [
      { account_id: 'a', balance: 100000, recorded_at: '2026-11-23T00:00:00Z' },
      { account_id: 'b', balance: 50000, recorded_at: '2026-11-10T00:00:00Z' },
    ]
  )
  assert.equal(r.amount, 150000)
  assert.equal(r.recordedAt, '2026-11-23T00:00:00Z')
  assert.equal(r.oldestRecordedAt, '2026-11-10T00:00:00Z')
  assert.deepEqual(r.accounts, [
    { accountId: 'a', recordedAt: '2026-11-23T00:00:00Z' },
    { accountId: 'b', recordedAt: '2026-11-10T00:00:00Z' },
  ])
})

test('一部の口座に残高の記録が無ければ合計しない（null）', () => {
  const r = sumLiquidCash(
    [{ id: 'a', type: 'bank' }, { id: 'b', type: 'bank' }],
    [{ account_id: 'a', balance: 100000, recorded_at: '2026-11-23T00:00:00Z' }]
  )
  assert.equal(r.amount, null)
  assert.equal(r.oldestRecordedAt, null)
  assert.deepEqual(r.accounts, [
    { accountId: 'a', recordedAt: '2026-11-23T00:00:00Z' },
    { accountId: 'b', recordedAt: null },
  ])
})

// ---- resolveLiquidCash: 旧テーブルへのフォールバック判定 ----
import { resolveLiquidCash } from './liquid-cash'

test('流動口座が0件なら旧テーブルの残高を使う', () => {
  const r = resolveLiquidCash(
    [{ id: 'a4', type: 'securities' }],
    [],
    { balance: 123456, recorded_at: '2026-09-01T00:00:00Z' }
  )
  assert.equal(r.amount, 123456)
  assert.equal(r.source, 'legacy_balance')
  assert.equal(r.oldestRecordedAt, '2026-09-01T00:00:00Z')
})

test('流動口座が0件で旧テーブルも無ければ none', () => {
  const r = resolveLiquidCash([], [], null)
  assert.equal(r.amount, null)
  assert.equal(r.source, 'none')
})

test('流動口座がすべて記録済みなら合計し、旧テーブルは無視する', () => {
  const r = resolveLiquidCash(
    [{ id: 'a1', type: 'bank' }, { id: 'a2', type: 'cash' }],
    [
      { account_id: 'a1', balance: 800000, recorded_at: '2026-09-01T00:00:00Z' },
      { account_id: 'a2', balance: 400000, recorded_at: '2026-09-02T00:00:00Z' },
    ],
    { balance: 1, recorded_at: '2026-01-01T00:00:00Z' }
  )
  assert.equal(r.amount, 1200000)
  assert.equal(r.source, 'accounts')
})

test('流動口座に未記録があれば null。旧テーブルへ落とさず、口座一覧を残す', () => {
  const r = resolveLiquidCash(
    [{ id: 'a1', type: 'bank' }, { id: 'a2', type: 'bank' }],
    [{ account_id: 'a1', balance: 800000, recorded_at: '2026-09-01T00:00:00Z' }],
    { balance: 999999, recorded_at: '2026-01-01T00:00:00Z' }
  )
  assert.equal(r.amount, null)
  assert.equal(r.source, 'accounts')
  assert.equal(r.accounts.length, 2)
  assert.equal(r.accounts.find(a => a.accountId === 'a2')?.recordedAt, null)
})
