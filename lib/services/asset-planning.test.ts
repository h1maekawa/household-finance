// Orchestrator の契約テスト。
// asset-planning が計算式を持たず、既存エンジンの値を束ねるだけであることを固定する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildAssetPlan,
  essentialMonthlyExpenses,
  GOAL_STATUS_LABEL,
  monthlyAssetContribution,
} from './asset-planning'
import { computeEmergencyFund } from './emergency-fund'
import { computeInvestmentCapacity } from './investment-capacity'
import { projectAssets } from './projection'
import type { BudgetSummary } from '@/types/budget'
import type { GoalProgress } from '@/types/goal'

const budget = {
  month: '2026-09',
  income: { planned: 300000, actual: 300000 },
  fixed: { planned: 135000, paid: 0, unpaid: 0, effective: 135000, items: [] },
  investment: { target: 30000 },
  savings: { target: 30000 },
  buffer: 20000,
  variable: {
    budget: 100000, spent: 40000, remaining: 60000,
    daysInMonth: 30, daysElapsed: 12, daysLeft: 18,
    dailyAllowance: 3333, pace: 1.0, byCategory: {}, categoryStats: {},
  },
  alerts: [],
} as unknown as BudgetSummary

const goals: GoalProgress[] = [{
  goalId: 'g1', title: '2027年までに100万円', kind: 'saving',
  targetAmount: 1000000, currentAmount: 400000, remainingAmount: 600000,
  progressRate: 0.4, requiredMonthly: 50000, monthlyPace: 37000,
  projectedAchievementMonth: '2028-03', monthsToTarget: 12, status: 'behind',
} as unknown as GoalProgress]

function plan(over: { availableCash?: number | null } = {}) {
  const emergencyFund = computeEmergencyFund({
    monthlyEssentialExpenses: essentialMonthlyExpenses({
      livingFixed: 120000, variableBudget: budget.variable.budget,
    }),
    currentLiquidCash: over.availableCash === undefined ? 500000 : over.availableCash,
    targetMonths: 3,
  })
  const capacity = computeInvestmentCapacity({
    month: '2026-09',
    availableCash: over.availableCash === undefined ? 500000 : over.availableCash,
    expectedIncome: 0, confirmedIncome: 300000, confirmedExpenses: 40000,
    pendingCardAmount: 0, fixedExpenses: 0, scheduledExpenses: 0,
    livingReserve: budget.variable.remaining, buffer: budget.buffer, alreadyInvested: 0,
    reserveGap: emergencyFund.reserveGap ?? 0,
    savingsTarget: budget.savings.target,
    investmentTarget: budget.investment.target,
    missingData: over.availableCash === null ? ['口座残高が未登録です'] : [],
  })
  return buildAssetPlan({
    month: '2026-09', budget, capacity, emergencyFund, goals,
    projection: projectAssets({
      currentAssets: over.availableCash === undefined ? 500000 : over.availableCash,
      monthlyContribution: monthlyAssetContribution(capacity) ?? 0,
      horizons: [1],
    }),
  })
}

test('free_to_spend は budget-engine の値をそのまま使う', () => {
  const p = plan()
  assert.equal(p.cashflow.freeToSpend, budget.variable.remaining)
  assert.equal(p.cashflow.dailyAllowance, budget.variable.dailyAllowance)
})

test('必須生活費は生活固定費＋変動費予算（積立投資を含めない）', () => {
  assert.equal(essentialMonthlyExpenses({ livingFixed: 120000, variableBudget: 100000 }), 220000)
  assert.equal(essentialMonthlyExpenses({ livingFixed: null, variableBudget: 100000 }), null)
  // 情報不足で0円になるときは「生活費0円」と言わず null にする
  assert.equal(essentialMonthlyExpenses({ livingFixed: 0, variableBudget: 0 }), null)
})

test('Goal は既存の status をラベルに写すだけ', () => {
  const p = plan()
  assert.equal(p.goals[0].status, 'behind')
  assert.equal(p.goals[0].statusLabel, 'やや不足')
  // 逆算値も goal-progress のものをそのまま持つ
  assert.equal(p.goals[0].requiredMonthly, 50000)
  assert.equal(p.goals[0].monthlyPace, 37000)
})

test('GoalTrackStatus の5状態すべてにラベルがある', () => {
  assert.deepEqual(Object.keys(GOAL_STATUS_LABEL).sort(),
    ['achieved', 'behind', 'on_track', 'stalled', 'unplanned'])
})

test('入力不足のときは0円と言わず null を返し confidence を下げる', () => {
  const p = plan({ availableCash: null })
  assert.equal(p.allocatableCash, null)
  for (const v of Object.values(p.allocation)) assert.equal(v, null)
  assert.equal(p.monthlyAssetContribution, null)
  assert.equal(p.confidence, 'low')
  assert.ok(p.missingData.some(m => m.includes('口座残高')))
  assert.deepEqual(p.projection, [])
})

test('confidence は investment-capacity の判定を引き継ぐ', () => {
  assert.equal(plan().confidence, 'high')
})

test('Orchestrator は計算式を持たない（契約）', () => {
  const src = readFileSync(path.join(process.cwd(), 'lib/services/asset-planning.ts'), 'utf8')
  // 目標の逆算をここで再実装しない
  assert.doesNotMatch(src, /remainingAmount\s*\/|targetAmount\s*-\s*currentAmount/)
  // 自由に使えるお金を独自に計算し直さない
  assert.doesNotMatch(src, /income\s*-\s*/)
  // 配分は investment-capacity の結果をそのまま写す
  assert.match(src, /capacity\.allocation\.emergency_fund/)
  assert.match(src, /capacity\.allocation\.asset_building/)
})
