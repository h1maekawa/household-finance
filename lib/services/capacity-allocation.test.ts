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
    alreadyInvested: 0, requiredReserve: 0, missingData: [],
    balanceOldestRecordedAt: '2026-09-01T00:00:00Z', now: new Date('2026-09-02T00:00:00Z'),
    ...over,
  }
}

const sum = (a: ReturnType<typeof computeInvestmentCapacity>['allocation']) =>
  a.emergency_fund! + a.savings! + a.asset_building! + a.unallocated_cash!

test('配分の合計は原資と円単位で一致する', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 100000, requiredReserve: 30000, savingsTarget: 30000, investmentTarget: 20000,
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
    availableCash: 420000, requiredReserve: 160000, savingsTarget: 30000, investmentTarget: 30000,
  }))
  assert.equal(r.allocation.emergency_fund, 160000)
  assert.equal(r.allocation.savings, 30000)
  assert.notEqual(r.allocation.savings, 190000)
})

test('すべて0以上', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 10000, requiredReserve: 999999, savingsTarget: 999999, investmentTarget: 999999,
  }))
  for (const v of Object.values(r.allocation)) assert.ok(v! >= 0, `負の配分: ${v}`)
})

test('防衛資金が不足していると資産形成へ全額は行かない', () => {
  const withGap = computeInvestmentCapacity(input({
    availableCash: 100000, requiredReserve: 80000, savingsTarget: 0, investmentTarget: 100000,
  }))
  assert.equal(withGap.allocation.emergency_fund, 80000)
  assert.equal(withGap.allocation.asset_building, 20000)

  const funded = computeInvestmentCapacity(input({
    availableCash: 100000, requiredReserve: 0, savingsTarget: 0, investmentTarget: 100000,
  }))
  assert.equal(funded.allocation.asset_building, 100000)
})

test('原資が足りなければ優先順のとおり上から埋まる', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 50000, requiredReserve: 30000, savingsTarget: 30000, investmentTarget: 30000,
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
    availableCash: 10000, livingReserve: 50000, requiredReserve: 30000, savingsTarget: 30000,
  }))
  assert.ok(r.allocatable_cash! < 0)
  assert.equal(sum(r.allocation), 0)
})

test('口座残高が無いときは0円と言わず null にする', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: null, requiredReserve: 30000, savingsTarget: 30000, investmentTarget: 20000,
  }))
  assert.equal(r.investable_amount, null)
  assert.equal(r.allocatable_cash, null)
  for (const v of Object.values(r.allocation)) assert.equal(v, null)
  assert.equal(r.confidence, 'low')
  assert.equal(monthlyAssetContribution(r), null)
})

test('毎月の積立は通常貯金＋資産形成。防衛資金は含めない', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 420000, requiredReserve: 160000, savingsTarget: 30000, investmentTarget: 30000,
  }))
  assert.equal(monthlyAssetContribution(r), 60000)
})

test('算出時刻を純関数の中で作らない（同じ入力なら完全に同じ結果）', () => {
  assert.deepEqual(computeInvestmentCapacity(input()), computeInvestmentCapacity(input()))
  assert.ok(!('calculated_at' in computeInvestmentCapacity(input())))
})

// ---- F10: 防衛資金は支払い後の現金（原資）から先に確保する ----

test('監査§5: 残高100万・支払い40万・必要60万 → 原資60万を全額防衛資金に確保', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 1_000_000, scheduledExpenses: 400_000, requiredReserve: 600_000,
    savingsTarget: 50_000, investmentTarget: 100_000,
  }))
  assert.equal(r.allocatable_cash, 600_000)
  assert.equal(r.allocation.emergency_fund, 600_000)
  assert.equal(r.allocation.savings, 0)
  assert.equal(r.allocation.asset_building, 0)
  assert.equal(r.allocation.unallocated_cash, 0)
  assert.equal(r.required_reserve, 600_000)
  assert.equal(r.emergency_fund_status, 'funded')
})

test('残高120万・支払い40万・必要60万 → 防衛資金60万のあと貯金・資産形成・未配分', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 1_200_000, scheduledExpenses: 400_000, requiredReserve: 600_000,
    savingsTarget: 50_000, investmentTarget: 100_000,
  }))
  assert.equal(r.allocatable_cash, 800_000)
  assert.equal(r.allocation.emergency_fund, 600_000)
  assert.equal(r.allocation.savings, 50_000)
  assert.equal(r.allocation.asset_building, 100_000)
  assert.equal(r.allocation.unallocated_cash, 50_000)
  assert.equal(r.emergency_fund_status, 'funded')
})

test('残高90万・支払い40万・必要60万 → 原資50万は全額防衛資金で不足', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 900_000, scheduledExpenses: 400_000, requiredReserve: 600_000,
    savingsTarget: 50_000, investmentTarget: 100_000,
  }))
  assert.equal(r.allocatable_cash, 500_000)
  assert.equal(r.allocation.emergency_fund, 500_000)
  assert.equal(r.allocation.savings, 0)
  assert.equal(r.allocation.asset_building, 0)
  assert.equal(r.allocation.unallocated_cash, 0)
  assert.equal(r.emergency_fund_status, 'underfunded')
})

test('二重計上しない: 4項目の合計は常に max(原資, 0)、どれも負にならない', () => {
  const cases: Partial<CapacityInput>[] = [
    { availableCash: 1_000_000, scheduledExpenses: 400_000, requiredReserve: 600_000, savingsTarget: 50_000, investmentTarget: 100_000 },
    { availableCash: 1_200_000, scheduledExpenses: 400_000, requiredReserve: 600_000, savingsTarget: 50_000, investmentTarget: 100_000 },
    { availableCash: 900_000, scheduledExpenses: 400_000, requiredReserve: 600_000, savingsTarget: 50_000, investmentTarget: 100_000 },
    { availableCash: 1_200_000, scheduledExpenses: 400_000, requiredReserve: 600_000, savingsTarget: 0, investmentTarget: 0 },
    { availableCash: 1_200_000, scheduledExpenses: 400_000, requiredReserve: 600_000, savingsTarget: 900_000, investmentTarget: 900_000 },
    { availableCash: 1_200_000, scheduledExpenses: 400_000, requiredReserve: 0, savingsTarget: 300_000, investmentTarget: 200_000 },
    { availableCash: 100_000, scheduledExpenses: 400_000, requiredReserve: 600_000, savingsTarget: 50_000, investmentTarget: 100_000 },
  ]
  for (const c of cases) {
    const r = computeInvestmentCapacity(input(c))
    assert.equal(sum(r.allocation), Math.max(r.allocatable_cash!, 0), JSON.stringify(c))
    for (const v of Object.values(r.allocation)) assert.ok(v! >= 0, JSON.stringify(c))
  }
})

test('原資がマイナスなら防衛資金は0で不足', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 100_000, scheduledExpenses: 400_000, requiredReserve: 600_000,
  }))
  assert.equal(r.allocation.emergency_fund, 0)
  assert.equal(r.emergency_fund_status, 'underfunded')
})

test('必須生活費が不明なら必要額もnull。配分4項目はすべてnullで0円と言わない', () => {
  const r = computeInvestmentCapacity(input({
    availableCash: 1_000_000, requiredReserve: null, savingsTarget: 50_000, investmentTarget: 100_000,
  }))
  assert.equal(r.required_reserve, null)
  assert.equal(r.emergency_fund_status, 'unknown')
  for (const v of Object.values(r.allocation)) assert.equal(v, null)
  assert.ok(r.missing_data.includes('生活防衛資金の必要額を算出できません'))
  // 後方互換: 原資は従来どおり返す
  assert.equal(r.investable_amount, 1_000_000)
  assert.equal(r.allocatable_cash, 1_000_000)
  assert.equal(monthlyAssetContribution(r), null)
})

test('契約: reserveGap ?? 0 で不明を0円に埋めていない', async () => {
  const { readFileSync } = await import('node:fs')
  for (const f of ['lib/services/capacity-input.ts', 'lib/services/asset-planning-loader.ts', 'lib/services/investment-capacity.ts']) {
    assert.ok(!/reserveGap\s*\?\?\s*0/.test(readFileSync(f, 'utf8')), `${f} に reserveGap ?? 0 が残っている`)
  }
})
