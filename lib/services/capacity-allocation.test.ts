// 3つの capacity が「同じ原資の配分」であることを固定するテスト。
// 別々に使えるお金として扱うと二重計上になる。
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeInvestmentCapacity, type CapacityInput } from './investment-capacity'

function input(over: Partial<CapacityInput> = {}): CapacityInput {
  return {
    month: '2026-09',
    availableCash: 500000,
    expectedIncome: 0,
    confirmedIncome: 300000,
    confirmedExpenses: 0,
    pendingCardAmount: 0,
    fixedExpenses: 0,
    scheduledExpenses: 0,
    livingReserve: 0,
    buffer: 0,
    alreadyInvested: 0,
    missingData: [],
    ...over,
  }
}

test('配分の合計は原資を超えない（円単位で一致する）', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 100000, reserveGap: 30000, savingsTarget: 30000, investmentTarget: 20000,
  }))
  assert.equal(r.allocatable_cash, 100000)
  assert.equal(r.saving_capacity, 60000) // 防衛資金30000 + 貯蓄目標30000
  assert.equal(r.asset_building_capacity, 20000)
  assert.equal(r.free_cash, 20000)
  assert.equal(
    r.saving_capacity! + r.asset_building_capacity! + r.free_cash!,
    Math.max(r.allocatable_cash!, 0)
  )
})

test('すべて0以上', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 10000, reserveGap: 999999, savingsTarget: 999999, investmentTarget: 999999,
  }))
  for (const v of [r.saving_capacity, r.asset_building_capacity, r.free_cash]) {
    assert.ok(v! >= 0, `負の配分が出ている: ${v}`)
  }
})

test('防衛資金が不足していると資産形成へ全額は行かない', () => {
  const withGap = computeInvestmentCapacity(input({
    availableCash: 100000, reserveGap: 80000, savingsTarget: 0, investmentTarget: 100000,
  }))
  assert.equal(withGap.saving_capacity, 80000)
  assert.equal(withGap.asset_building_capacity, 20000)

  // 防衛資金が満たされていれば同じ原資が資産形成へ回る
  const funded = computeInvestmentCapacity(input({
    availableCash: 100000, reserveGap: 0, savingsTarget: 0, investmentTarget: 100000,
  }))
  assert.equal(funded.asset_building_capacity, 100000)
})

test('原資が足りなければ優先順のとおり上から埋まる', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 50000, reserveGap: 30000, savingsTarget: 30000, investmentTarget: 30000,
  }))
  assert.equal(r.saving_capacity, 50000) // 防衛30000 + 貯蓄20000（残り全部）
  assert.equal(r.asset_building_capacity, 0)
  assert.equal(r.free_cash, 0)
})

test('目標が未設定なら自由余力として残る（勝手に投資へ回さない）', () => {
  const r = computeInvestmentCapacity(input({ availableCash: 100000 }))
  assert.equal(r.saving_capacity, 0)
  assert.equal(r.asset_building_capacity, 0)
  assert.equal(r.free_cash, 100000)
})

test('使いすぎで原資がマイナスでも配分は0で、負にならない', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 10000, livingReserve: 50000, reserveGap: 30000, savingsTarget: 30000,
  }))
  assert.ok(r.allocatable_cash! < 0)
  assert.equal(r.saving_capacity, 0)
  assert.equal(r.asset_building_capacity, 0)
  assert.equal(r.free_cash, 0)
})

test('口座残高が無いときは0円と言わず null にする', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: null, reserveGap: 30000, savingsTarget: 30000, investmentTarget: 20000,
  }))
  assert.equal(r.investable_amount, null)
  assert.equal(r.allocatable_cash, null)
  assert.equal(r.saving_capacity, null)
  assert.equal(r.asset_building_capacity, null)
  assert.equal(r.free_cash, null)
  assert.equal(r.confidence, 'low')
})

test('算出時刻を純関数の中で作らない（同じ入力なら完全に同じ結果）', () => {
  const a = computeInvestmentCapacity(input())
  const b = computeInvestmentCapacity(input())
  assert.deepEqual(a, b)
  assert.ok(!('calculated_at' in a), 'timestamp は I/O 境界で付けること')
})
