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
  })
  assert.equal(result.confidence, 'high')
})
