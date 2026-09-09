// 「今月のお金の配分」が同じ原資の分配であることを固定するテスト。
// 4つを別々に使えるお金として扱うと二重計上になる。
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeInvestmentCapacity, type CapacityInput } from './investment-capacity'
import { monthlyAssetContribution } from './asset-planning'

function input(over: Partial<CapacityInput> = {}): CapacityInput {
  return {
    month: '2026-09', availableCash: 500000, expectedIncome: 0,
    confirmedIncome: 300000, confirmedExpenses: 0, pendingCardAmount: 0,
    fixedExpenses: 0, scheduledExpenses: 0, livingReserve: 0, buffer: 0,
    alreadyInvested: 0, missingData: [], ...over,
  }
}

const sum = (a: ReturnType<typeof computeInvestmentCapacity>['allocation']) =>
  a.emergency_fund! + a.savings! + a.asset_building! + a.unallocated_cash!

test('配分の合計は原資と円単位で一致する', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 100000, reserveGap: 30000, savingsTarget: 30000, investmentTarget: 20000,
  }))
  assert.equal(r.allocatable_cash, 100000)
  assert.equal(r.allocation.emergency_fund, 30000)
  assert.equal(r.allocation.savings, 30000)
  assert.equal(r.allocation.asset_building, 20000)
  assert.equal(r.allocation.unallocated_cash, 20000)
  assert.equal(sum(r.allocation), Math.max(r.allocatable_cash!, 0))
})

test('防衛資金の確保と通常貯金を混ぜない', () => {
  // 防衛資金160,000は手元現金の振り替え、通常貯金30,000は今月の貯蓄目標。
  // 合算して「今月19万円貯金できる」と見せない
  const r = computeInvestmentCapacity(input({
    availableCash: 420000, reserveGap: 160000, savingsTarget: 30000, investmentTarget: 30000,
  }))
  assert.equal(r.allocation.emergency_fund, 160000)
  assert.equal(r.allocation.savings, 30000)
  assert.notEqual(r.allocation.savings, 190000)
})

test('すべて0以上', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 10000, reserveGap: 999999, savingsTarget: 999999, investmentTarget: 999999,
  }))
  for (const v of Object.values(r.allocation)) assert.ok(v! >= 0, `負の配分: ${v}`)
})

test('防衛資金が不足していると資産形成へ全額は行かない', () => {
  const withGap = computeInvestmentCapacity(input({
    availableCash: 100000, reserveGap: 80000, savingsTarget: 0, investmentTarget: 100000,
  }))
  assert.equal(withGap.allocation.emergency_fund, 80000)
  assert.equal(withGap.allocation.asset_building, 20000)

  const funded = computeInvestmentCapacity(input({
    availableCash: 100000, reserveGap: 0, savingsTarget: 0, investmentTarget: 100000,
  }))
  assert.equal(funded.allocation.asset_building, 100000)
})

test('原資が足りなければ優先順のとおり上から埋まる', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 50000, reserveGap: 30000, savingsTarget: 30000, investmentTarget: 30000,
  }))
  assert.equal(r.allocation.emergency_fund, 30000)
  assert.equal(r.allocation.savings, 20000)
  assert.equal(r.allocation.asset_building, 0)
  assert.equal(r.allocation.unallocated_cash, 0)
})

test('目標が未設定なら未配分として残る（勝手に投資へ回さない）', () => {
  const r = computeInvestmentCapacity(input({ availableCash: 100000 }))
  assert.equal(r.allocation.savings, 0)
  assert.equal(r.allocation.asset_building, 0)
  assert.equal(r.allocation.unallocated_cash, 100000)
})

test('使いすぎで原資がマイナスでも配分は0で、負にならない', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 10000, livingReserve: 50000, reserveGap: 30000, savingsTarget: 30000,
  }))
  assert.ok(r.allocatable_cash! < 0)
  assert.equal(sum(r.allocation), 0)
})

test('口座残高が無いときは0円と言わず null にする', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: null, reserveGap: 30000, savingsTarget: 30000, investmentTarget: 20000,
  }))
  assert.equal(r.investable_amount, null)
  assert.equal(r.allocatable_cash, null)
  for (const v of Object.values(r.allocation)) assert.equal(v, null)
  assert.equal(r.confidence, 'low')
  assert.equal(monthlyAssetContribution(r), null)
})

test('毎月の積立は通常貯金＋資産形成。防衛資金は含めない', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 420000, reserveGap: 160000, savingsTarget: 30000, investmentTarget: 30000,
  }))
  assert.equal(monthlyAssetContribution(r), 60000)
})

test('算出時刻を純関数の中で作らない（同じ入力なら完全に同じ結果）', () => {
  assert.deepEqual(computeInvestmentCapacity(input()), computeInvestmentCapacity(input()))
  assert.ok(!('calculated_at' in computeInvestmentCapacity(input())))
})
