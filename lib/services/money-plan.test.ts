import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMoneyPlan, groupFixedByCategory, goalBreakdown } from './money-plan'
import type { BudgetSummary, CategoryBudget } from '@/types/budget'
import type { GoalProgress } from '@/types/goal'
import type { ResolvedScheduledPayment } from '@/types/cashflow'

function summary(overrides: Partial<BudgetSummary> = {}): BudgetSummary {
  return {
    month: '2026-07',
    income: { planned: 251225, actual: 251225 },
    fixed: { planned: 87328, paid: 87328, unpaid: 0, effective: 87328, items: [] },
    investment: { target: 20000 },
    savings: { target: 70000 },
    buffer: 0,
    variable: {
      budget: 73897,
      spent: 48320,
      remaining: 25577,
      daysInMonth: 31,
      daysElapsed: 27,
      daysLeft: 4,
      dailyAllowance: 6394,
      pace: 1.0,
      byCategory: { 食費: 18300, 外食: 7200, 娯楽: 3500 },
      categoryStats: {},
    },
    alerts: [],
    ...overrides,
  }
}

function fixedPayment(
  overrides: Partial<ResolvedScheduledPayment> = {}
): ResolvedScheduledPayment {
  return {
    id: 'sp-1',
    name: '家賃',
    amount: 58330,
    due_day: 26,
    category: '住居費',
    type: 'fixed',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    resolvedDueDate: '2026-07-27',
    resolvedAmountYen: 58330,
    debitAccountName: '三井住友銀行',
    ...overrides,
  }
}

function goal(overrides: Partial<GoalProgress> = {}): GoalProgress {
  return {
    goalId: 'g-1',
    title: '親への返済',
    kind: 'custom',
    targetAmount: 500000,
    currentAmount: 100000,
    remainingAmount: 400000,
    progressRate: 0.2,
    requiredMonthly: 40000,
    monthlyPace: 40000,
    projectedAchievementMonth: '2027-07',
    monthsToTarget: 10,
    status: 'on_track',
    ...overrides,
  }
}

// ---------------------------------------------------------------- 固定費の内訳

test('固定費はカテゴリ別に合算され、金額の大きい順に並ぶ', () => {
  const rows = groupFixedByCategory([
    fixedPayment(),
    fixedPayment({ id: 'sp-2', name: '保険①', category: '保険', resolvedAmountYen: 3328 }),
    fixedPayment({ id: 'sp-3', name: 'ジブラルタ', category: '保険', resolvedAmountYen: 15500 }),
    fixedPayment({ id: 'sp-4', name: '楽天モバイル', category: '通信費', resolvedAmountYen: 3890 }),
  ])

  assert.deepEqual(rows, [
    { label: '住居費', amount: 58330 },
    { label: '保険', amount: 18828 }, // 3,328 + 15,500 が合算される
    { label: '通信費', amount: 3890 },
  ])
})

test('金額未登録(0円)と無効な固定費は流れに乗せない', () => {
  const rows = groupFixedByCategory([
    fixedPayment({ id: 'a', name: 'Apple Music', category: 'サブスク', resolvedAmountYen: 0 }),
    fixedPayment({ id: 'b', is_active: false, resolvedAmountYen: 5000 }),
  ])
  assert.deepEqual(rows, [])
})

test('外貨建ては円換算後の額で合算される', () => {
  // amount は 0 でも resolvedAmountYen(105USD → 15,500円)を使う
  const rows = groupFixedByCategory([
    fixedPayment({ name: 'ジブラルタ', category: '保険', amount: 0, resolvedAmountYen: 15500 }),
  ])
  assert.deepEqual(rows, [{ label: '保険', amount: 15500 }])
})

// ---------------------------------------------------------------- 目標の内訳

test('目標は毎月の必要額で並び、達成済みは除外される', () => {
  const rows = goalBreakdown([
    goal(),
    goal({ goalId: 'g-2', title: '生活防衛資金', requiredMonthly: 30000, projectedAchievementMonth: null }),
    goal({ goalId: 'g-3', title: '完了した目標', status: 'achieved', requiredMonthly: 99999 }),
  ])

  assert.equal(rows.length, 2)
  assert.equal(rows[0].label, '親への返済')
  assert.equal(rows[0].amount, 40000)
  assert.equal(rows[1].label, '生活防衛資金')
})

// ---------------------------------------------------------------- 滝の組み立て

test('お金の流れが 収入 → 固定費 → 目標 → 投資 → 自由 の順で組み立つ', () => {
  const plan = buildMoneyPlan({
    month: '2026-07',
    budget: summary(),
    categoryBudgets: [],
    fixedPayments: [fixedPayment()],
    goals: [goal()],
  })

  assert.deepEqual(plan.steps.map(s => s.key), ['income', 'fixed', 'goals', 'investment', 'free'])
  assert.equal(plan.freeBudget, 73897)
  // 251,225 − 87,328 − 70,000 − 20,000 = 73,897(budget-engine の式と一致する)
  assert.equal(
    plan.steps[0].amount - plan.steps[1].amount - plan.steps[2].amount - plan.steps[3].amount,
    plan.freeBudget
  )
})

test('固定費率は収入に対する割合で出る', () => {
  const plan = buildMoneyPlan({
    month: '2026-07',
    budget: summary(),
    categoryBudgets: [],
    fixedPayments: [],
    goals: [],
  })
  // 87,328 / 251,225 = 34.7%
  assert.equal(Math.round(plan.fixedRatio * 1000) / 10, 34.8)
})

test('金額0のステップは省くが、収入と自由予算は0でも残す', () => {
  const plan = buildMoneyPlan({
    month: '2026-07',
    budget: summary({
      income: { planned: 0, actual: 0 },
      investment: { target: 0 },
      savings: { target: 0 },
      buffer: 0,
      variable: { ...summary().variable, budget: 0 },
    }),
    categoryBudgets: [],
    fixedPayments: [],
    goals: [],
  })

  assert.deepEqual(plan.steps.map(s => s.key), ['income', 'fixed', 'free'])
})

// ---------------------------------------------------------------- カテゴリ配分

test('カテゴリ配分は予算枠と実績から消化率を出す', () => {
  const categoryBudgets: CategoryBudget[] = [
    { category: '食費', amount: 30000, source: 'ai' },
    { category: '外食', amount: 10000, source: 'ai' },
  ]

  const plan = buildMoneyPlan({
    month: '2026-07',
    budget: summary(),
    categoryBudgets,
    fixedPayments: [],
    goals: [],
  })

  const food = plan.categories.find(c => c.category === '食費')
  assert.equal(food?.budget, 30000)
  assert.equal(food?.spent, 18300)
  assert.equal(food?.remaining, 11700)
  assert.equal(Math.round((food?.usage ?? 0) * 100), 61)
})

test('予算枠が無いのに使っているカテゴリも末尾に出す', () => {
  const plan = buildMoneyPlan({
    month: '2026-07',
    budget: summary(),
    categoryBudgets: [{ category: '食費', amount: 30000, source: 'ai' }],
    fixedPayments: [],
    goals: [],
  })

  // 娯楽(3,500)は予算枠が無いが実績がある → 見落とすと自由予算が合わなくなる
  const leisure = plan.categories.find(c => c.category === '娯楽')
  assert.equal(leisure?.unbudgeted, true)
  assert.equal(leisure?.spent, 3500)
  assert.equal(leisure?.remaining, -3500)
  assert.equal(plan.categories.at(-1)?.unbudgeted, true, '予算外は末尾に並ぶ')
})
