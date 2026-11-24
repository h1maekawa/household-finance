import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFinanceSummary } from './finance-summary'

test('finance summary は既存loaderの確定値を契約へ写す', () => {
  const result = buildFinanceSummary({
    planning: {
      budget: {
        income: { planned: 300_000, actual: 280_000 },
        fixed: { effective: 120_000 },
        variable: { spent: 70_000 },
      },
      plan: {
        month: '2026-09',
        cashflow: { freeToSpend: 80_000, dailyAllowance: 2_666 },
        allocation: { savings: 40_000, assetBuilding: 30_000, unallocatedCash: 20_000 },
        confidence: 'high',
      },
      assets: {
        liquidCash: 500_000,
        stockValue: 600_000,
        fundValue: 100_000,
        otherAssets: 50_000,
        totalAssets: 1_250_000,
        recordedAt: '2026-09-30T00:00:00.000Z',
      },
    } as never,
    cashflow: {
      startingBalance: 500_000,
      startingBalanceOldestRecordedAt: '2026-09-30T00:00:00.000Z',
      projectedDays: [{ isNegative: false }],
      unassignedCardUsage: { count: 2 },
    } as never,
    unreviewedTransactions: 3,
    generatedAt: '2026-09-30T01:00:00.000Z',
  })

  assert.deepEqual(result.income, { planned: 300_000, actual: 280_000 })
  assert.deepEqual(result.expenses, { fixed: 120_000, variable: 70_000, total: 190_000 })
  assert.deepEqual(result.cashflow, { free_to_spend: 80_000, daily_allowance: 2_666 })
  assert.deepEqual(result.capacity, { saving: 40_000, asset_building: 30_000, free_cash: 20_000 })
  assert.deepEqual(result.assets, {
    cash: 500_000,
    investment: 700_000,
    other: 50_000,
    total: 1_250_000,
    recorded_at: '2026-09-30T00:00:00.000Z',
  })
  assert.deepEqual(result.review, {
    unreviewed_transactions: 3,
    unassigned_card_usage: 2,
    negative_balance_risk: false,
    negative_balance_risk_known: true,
    negative_balance_risk_caveat: null,
  })
  assert.equal(result.confidence, 'high')
})

test('開始残高が未登録なら negative_balance_risk は判定不能として返す', () => {
  const base = {
    planning: {
      plan: { month: '2026-09', confidence: 'low', cashflow: { freeToSpend: null, dailyAllowance: null }, allocation: {} },
      budget: { income: {}, fixed: { effective: 0 }, variable: { spent: 0 } },
      assets: { liquidCash: null, stockValue: 0, fundValue: 0, otherAssets: 0, totalAssets: 0, recordedAt: null },
    } as never,
    cashflow: { startingBalance: null, projectedDays: [] } as never,
    unreviewedTransactions: 0,
    generatedAt: '2026-09-30T01:00:00.000Z',
  }
  const r = buildFinanceSummary(base)
  assert.equal(r.review.negative_balance_risk, false)
  assert.equal(r.review.negative_balance_risk_known, false)
})

test('negative_balance_risk_caveat：記録日が過去なら注意書き、残高不明なら null', () => {
  const planning = {
    plan: { month: '2026-11', confidence: 'low', cashflow: { freeToSpend: null, dailyAllowance: null }, allocation: {} },
    budget: { income: {}, fixed: { effective: 0 }, variable: { spent: 0 } },
    assets: { liquidCash: null, stockValue: 0, fundValue: 0, otherAssets: 0, totalAssets: 0, recordedAt: null },
  } as never
  const known = buildFinanceSummary({
    planning,
    cashflow: { startingBalance: 1, startingBalanceOldestRecordedAt: '2026-11-20T09:00:00+09:00', projectedDays: [] } as never,
    unreviewedTransactions: 0,
    generatedAt: '2026-11-28T01:00:00.000Z',
  })
  assert.equal(
    known.review.negative_balance_risk_caveat,
    '不足見込みは検出されていません（残高記録日 11/20 以降の引落は予測に未反映のため、不足なしとは断定できません）',
  )
  const unknown = buildFinanceSummary({
    planning,
    cashflow: { startingBalance: null, startingBalanceOldestRecordedAt: null, projectedDays: [] } as never,
    unreviewedTransactions: 0,
    generatedAt: '2026-11-28T01:00:00.000Z',
  })
  assert.equal(unknown.review.negative_balance_risk_caveat, null)
})

// negative_balance_risk_known：開始残高が既知 かつ 最も古い口座の記録が7日（168時間）以内
function summaryWith(cashflow: object) {
  return buildFinanceSummary({
    planning: {
      plan: { month: '2026-11', confidence: 'low', cashflow: { freeToSpend: null, dailyAllowance: null }, allocation: {} },
      budget: { income: {}, fixed: { effective: 0 }, variable: { spent: 0 } },
      assets: { liquidCash: null, stockValue: 0, fundValue: 0, otherAssets: 0, totalAssets: 0, recordedAt: null },
    } as never,
    cashflow: { projectedDays: [{ isNegative: false }], ...cashflow } as never,
    unreviewedTransactions: 0,
    generatedAt: '2026-11-28T01:00:00.000Z',
  })
}

test('negative_balance_risk_known：記録8日前 → false（判定不可）', () => {
  const r = summaryWith({ startingBalance: 500_000, startingBalanceOldestRecordedAt: '2026-11-20T01:00:00.000Z' })
  assert.equal(r.review.negative_balance_risk_known, false)
})

test('negative_balance_risk_known：記録6日前 → true＋注意書き', () => {
  const r = summaryWith({ startingBalance: 500_000, startingBalanceOldestRecordedAt: '2026-11-22T01:00:00.000Z' })
  assert.equal(r.review.negative_balance_risk_known, true)
  assert.equal(
    r.review.negative_balance_risk_caveat,
    '不足見込みは検出されていません（残高記録日 11/22 以降の引落は予測に未反映のため、不足なしとは断定できません）',
  )
})

test('negative_balance_risk_known：残高未登録 → false', () => {
  const r = summaryWith({ startingBalance: null, startingBalanceOldestRecordedAt: null, projectedDays: [] })
  assert.equal(r.review.negative_balance_risk_known, false)
})
