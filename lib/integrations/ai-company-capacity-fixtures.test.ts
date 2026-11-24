// AI Company 結合テスト用の固定フィクスチャ（Flow+ 側）。
// capacity-scenario と同じ入力を、実際のルートと同じ組み立て
// （buildCapacityObligations → computeInvestmentCapacity → toCapacityResponse）で通した JSON を
// docs/fixtures/ai-company/ に固定する。AI Company 側のテストは同じ JSON を読む。
// 再生成: UPDATE_FIXTURES=1 node --import ./scripts/register-test-resolver.mjs --test lib/integrations/ai-company-capacity-fixtures.test.ts
// すべて架空値。個人データ・秘密情報は入れない。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { toCapacityResponse } from './capacity-response'
import { MONTH, SCENARIO_NOW, runScenario } from '@/lib/services/__fixtures__/capacity-scenario'
import { computeEmergencyFund } from '@/lib/services/emergency-fund'
import type { BudgetSummary } from '@/types/budget'

const DIR = path.join(process.cwd(), 'docs', 'fixtures', 'ai-company')

const budgetSummary = {
  month: MONTH,
  variable: {
    budget: 120000,
    spent: 90000,
    remaining: 30000,
    daysInMonth: 30,
    daysElapsed: 28,
    daysLeft: 2,
    dailyAllowance: 15000,
    pace: 0.8,
  },
} as unknown as BudgetSummary

function build(balanceBRecordedAt: string | null) {
  const { capacity } = runScenario(balanceBRecordedAt)
  const known = balanceBRecordedAt !== null
  return toCapacityResponse({
    capacity,
    emergencyFund: computeEmergencyFund({
      monthlyEssentialExpenses: 200000,
      currentLiquidCash: known ? 1300000 : null,
      targetMonths: 3,
    }),
    budgetSummary,
    liquidCash: {
      recordedAt: known ? '2026-11-27T09:00:00+09:00' : null,
      source: known ? 'accounts' : 'none',
    },
    source: 'transactions',
    now: SCENARIO_NOW,
  })
}

const cases = {
  stale: build('2026-11-20T09:00:00+09:00'),
  fresh: build('2026-11-22T09:00:00+09:00'),
  unknown: build(null),
}

const LEGACY_FIELDS = [
  'investable_amount', 'available_cash', 'pending_card_amount', 'fixed_expenses', 'scheduled_expenses',
  'already_invested', 'calculated_at', 'data_freshness', 'confidence', 'missing_data',
  'emergency_fund', 'living', 'balance_recorded_at', 'source',
]

for (const [name, json] of Object.entries(cases)) {
  const file = path.join(DIR, `investment-capacity-${name}.json`)
  test(`フィクスチャ ${name}: 固定JSONと完全一致する`, () => {
    // 往復して undefined 等を落とし、実際のHTTPレスポンスと同じ形にする
    const actual = JSON.parse(JSON.stringify(json))
    if (process.env.UPDATE_FIXTURES === '1') {
      mkdirSync(DIR, { recursive: true })
      writeFileSync(file, JSON.stringify(actual, null, 2) + '\n')
    }
    assert.deepEqual(actual, JSON.parse(readFileSync(file, 'utf8')))
  })
  test(`フィクスチャ ${name}: PR-1以前からあるフィールドが全部ある`, () => {
    const actual = JSON.parse(readFileSync(file, 'utf8'))
    for (const f of LEGACY_FIELDS) assert.ok(f in actual, `${f} がありません`)
  })
}

test('stale: 8日経過。金額は775,410（600,000/50,000/100,000/25,410）', () => {
  const j = cases.stale
  assert.equal(j.data_freshness, 'stale')
  assert.equal(j.investable_amount, 775410)
  assert.deepEqual(j.allocation, { emergency_fund: 600000, savings: 50000, asset_building: 100000, unallocated_cash: 25410 })
})

test('fresh: 6日3時間。current で金額は stale と同じ', () => {
  const j = cases.fresh
  assert.equal(j.data_freshness, 'current')
  assert.equal(j.investable_amount, 775410)
  assert.deepEqual(j.allocation, cases.stale.allocation)
})

test('unknown: 口座残高なし。投資可能額と配分4項目は null', () => {
  const j = cases.unknown
  assert.equal(j.data_freshness, 'unknown')
  assert.equal(j.investable_amount, null)
  assert.deepEqual(j.allocation, { emergency_fund: null, savings: null, asset_building: null, unallocated_cash: null })
})
