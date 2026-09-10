import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOME_ACTION_LIMIT,
  MAX_MONTHLY_ACTIONS,
  buildMonthlyActions,
  type ActionPlannerInput,
} from './action-planner'
import type { CoachInsight } from '@/types/coach'
import type { CategoryProgress } from '@/types/budget'
import type { AssetPlanningResult } from './asset-planning'

/**
 * action-planner が読むのは emergencyFund / allocation / missingData だけ。
 * MoneyPlan まで組み立てると、この関数が見ていない値でテストが壊れる
 */
function plan(patch: Partial<AssetPlanningResult> = {}): AssetPlanningResult {
  return {
    allocation: {
      emergencyFund: 0,
      savings: 0,
      assetBuilding: 0,
      unallocatedCash: 0,
    },
    emergencyFund: {
      targetMonths: 3,
      monthlyEssentialExpenses: 200_000,
      requiredReserve: 600_000,
      currentReserve: 600_000,
      reserveGap: 0,
      fundedRatio: 1,
      status: 'funded',
    },
    missingData: [],
    ...patch,
  } as AssetPlanningResult
}

const input = (patch: Partial<ActionPlannerInput> = {}): ActionPlannerInput => ({
  month: '2026-09',
  plan: plan(),
  insights: [],
  categoryProgress: [],
  uncategorizedCount: 0,
  unassignedCardUsage: null,
  firstNegativeDay: null,
  ...patch,
})

const insight = (patch: Partial<CoachInsight>): CoachInsight => ({
  type: 'category_over',
  severity: 'warning',
  title: '',
  body: '',
  payload: { action: 'none' },
  priority: 50,
  generated_for: '2026-09-11',
  ...patch,
})

const progress = (category: string, remaining: number): CategoryProgress => ({
  category,
  budget: 30_000,
  spent: 30_000 - remaining,
  remaining,
  rate: 0,
  pace: 1,
  average: 2_000,
  count: 5,
})

// ---------------------------------------------------------------- §35 件数

test('何も無ければ空。無理に埋めない', () => {
  assert.deepEqual(buildMonthlyActions(input()), [])
})

test('最大5件までしか出さない', () => {
  const result = buildMonthlyActions(
    input({
      plan: plan({
        allocation: { emergencyFund: 0, savings: 30_000, assetBuilding: 30_000, unallocatedCash: 0 },
        missingData: ['口座残高が未登録です', '月収の設定がありません'],
      }),
      uncategorizedCount: 4,
      unassignedCardUsage: { count: 2, total: 8_000 },
      firstNegativeDay: { date: '2026-10-05', balance: -12_000 },
    })
  )
  assert.equal(result.length, MAX_MONTHLY_ACTIONS)
  assert.equal(MAX_MONTHLY_ACTIONS, 5)
})

test('Home に出すのは3件まで', () => {
  assert.equal(HOME_ACTION_LIMIT, 3)
  assert.ok(HOME_ACTION_LIMIT <= MAX_MONTHLY_ACTIONS)
})

// ---------------------------------------------------------------- 優先順位

test('残高不足が最優先で出る', () => {
  const result = buildMonthlyActions(
    input({
      plan: plan({
        allocation: { emergencyFund: 0, savings: 30_000, assetBuilding: 30_000, unallocatedCash: 0 },
      }),
      uncategorizedCount: 4,
      firstNegativeDay: { date: '2026-10-05', balance: -12_000 },
    })
  )
  assert.equal(result[0].kind, 'payment')
  assert.equal(result[0].severity, 'action')
  assert.equal(result[0].amount, 12_000)
  assert.equal(result[0].title, '10月5日までに ¥12,000 用意する')
})

test('深刻な順 → 優先度順で並ぶ', () => {
  const result = buildMonthlyActions(
    input({
      plan: plan({
        allocation: { emergencyFund: 0, savings: 30_000, assetBuilding: 0, unallocatedCash: 0 },
      }),
      uncategorizedCount: 4,
      firstNegativeDay: { date: '2026-10-05', balance: -12_000 },
    })
  )
  const severities = result.map(a => a.severity)
  const rank = { action: 3, warning: 2, info: 1 } as const
  assert.deepEqual(
    severities.map(s => rank[s]),
    [...severities.map(s => rank[s])].sort((a, b) => b - a)
  )
})

// ---------------------------------------------------------------- §36 支出

test('未超過なら「残り◯円以内に」。残額は budget-engine の値を使う', () => {
  const result = buildMonthlyActions(
    input({
      insights: [
        insight({
          type: 'category_pace_high',
          payload: { action: 'reduce_category', category: '外食', amount: 0, times: 0 },
        }),
      ],
      categoryProgress: [progress('外食', 5_000)],
    })
  )
  assert.equal(result[0].kind, 'expense')
  assert.equal(result[0].title, '外食を残り ¥5,000 以内に')
  assert.equal(result[0].amount, 5_000)
})

test('超過済みなら「◯円戻す」と言う', () => {
  const result = buildMonthlyActions(
    input({
      insights: [
        insight({
          type: 'category_over',
          payload: { action: 'reduce_category', category: '外食', amount: 6_200, times: 3 },
        }),
      ],
      categoryProgress: [progress('外食', -6_200)],
    })
  )
  assert.equal(result[0].title, '外食を ¥6,200 戻す')
  assert.equal(result[0].amount, 6_200)
})

test('判定を自前で作らない。洞察が無ければ支出アクションも出ない', () => {
  const result = buildMonthlyActions(
    input({ insights: [], categoryProgress: [progress('外食', -20_000)] })
  )
  assert.equal(result.filter(a => a.kind === 'expense').length, 0)
})

// ---------------------------------------------------------------- §36 配分

test('貯金・資産形成の金額は asset-planning の配分をそのまま使う', () => {
  const result = buildMonthlyActions(
    input({
      plan: plan({
        allocation: { emergencyFund: 0, savings: 30_000, assetBuilding: 30_000, unallocatedCash: 0 },
      }),
    })
  )
  const savings = result.find(a => a.kind === 'savings')
  const investment = result.find(a => a.kind === 'investment')
  assert.equal(savings?.title, '¥30,000 を貯金へ')
  assert.equal(savings?.amount, 30_000)
  assert.equal(investment?.title, '¥30,000 を資産形成へ')
})

test('配分が0円や算出不能なら出さない', () => {
  for (const allocation of [
    { emergencyFund: 0, savings: 0, assetBuilding: 0, unallocatedCash: 0 },
    { emergencyFund: null, savings: null, assetBuilding: null, unallocatedCash: null },
  ]) {
    const result = buildMonthlyActions(input({ plan: plan({ allocation }) }))
    assert.equal(result.filter(a => a.kind === 'savings' || a.kind === 'investment').length, 0)
  }
})

test('防衛資金は不足しているときだけ出す', () => {
  const underfunded = buildMonthlyActions(
    input({
      plan: plan({
        emergencyFund: {
          targetMonths: 3,
          monthlyEssentialExpenses: 200_000,
          requiredReserve: 600_000,
          currentReserve: 440_000,
          reserveGap: 160_000,
          fundedRatio: 0.73,
          status: 'underfunded',
        },
      }),
    })
  )
  assert.equal(underfunded[0].kind, 'emergency_fund')
  assert.equal(underfunded[0].amount, 160_000)

  // 算出不能(unknown)のときに「0円必要」と言わない
  const unknown = buildMonthlyActions(
    input({
      plan: plan({
        emergencyFund: {
          targetMonths: 3,
          monthlyEssentialExpenses: null,
          requiredReserve: null,
          currentReserve: null,
          reserveGap: null,
          fundedRatio: null,
          status: 'unknown',
        },
      }),
    })
  )
  assert.equal(unknown.filter(a => a.kind === 'emergency_fund').length, 0)
})

// ---------------------------------------------------------------- 副業

test('副業は目標の不足額から出し、金額を発明しない', () => {
  const result = buildMonthlyActions(
    input({
      insights: [
        insight({
          type: 'goal_behind',
          payload: {
            action: 'review_goal',
            goal_id: 'g1',
            required_monthly: 90_000,
            monthly_pace: 60_000,
          },
        }),
      ],
    })
  )
  const side = result.find(a => a.kind === 'side_income')
  assert.equal(side?.amount, 30_000)
  assert.equal(side?.href, '/plan?tab=future')
})

test('不足していない目標では副業アクションを出さない', () => {
  const result = buildMonthlyActions(
    input({
      insights: [
        insight({
          type: 'goal_behind',
          payload: {
            action: 'review_goal',
            goal_id: 'g1',
            required_monthly: 50_000,
            monthly_pace: 60_000,
          },
        }),
      ],
    })
  )
  assert.equal(result.filter(a => a.kind === 'side_income').length, 0)
})

// ---------------------------------------------------------------- 確認・設定

test('未分類取引は件数が1件以上のときだけ', () => {
  assert.equal(buildMonthlyActions(input({ uncategorizedCount: 0 })).length, 0)
  const result = buildMonthlyActions(input({ uncategorizedCount: 4 }))
  assert.equal(result[0].title, '未分類の取引を 4件 確認する')
  assert.equal(result[0].amount, null)
})

test('設定不足はエンジンが出した文言をそのまま出す', () => {
  const result = buildMonthlyActions(
    input({ plan: plan({ missingData: ['口座残高が未登録です'] }) })
  )
  assert.equal(result[0].kind, 'settings')
  assert.equal(result[0].title, '口座残高が未登録です')
})

// ---------------------------------------------------------------- 重複

test('同じ行動を二重に出さない', () => {
  const duplicated = insight({
    type: 'category_over',
    payload: { action: 'reduce_category', category: '外食', amount: 6_200, times: 3 },
  })
  const result = buildMonthlyActions(
    input({ insights: [duplicated, duplicated], categoryProgress: [progress('外食', -6_200)] })
  )
  assert.equal(result.filter(a => a.id === 'expense:外食').length, 1)
})

test('id はすべて一意', () => {
  const result = buildMonthlyActions(
    input({
      plan: plan({
        allocation: { emergencyFund: 0, savings: 30_000, assetBuilding: 30_000, unallocatedCash: 0 },
        missingData: ['口座残高が未登録です'],
      }),
      uncategorizedCount: 2,
    })
  )
  assert.equal(new Set(result.map(a => a.id)).size, result.length)
})
