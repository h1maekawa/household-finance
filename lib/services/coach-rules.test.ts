import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCoachInsights,
  formatYen,
  selectTodaysInsight,
} from '@/lib/services/coach-rules'
import { computeBudget, computeCategoryProgress } from '@/lib/services/budget-engine'
import type { CoachContext } from '@/types/coach'
import type { BudgetSummary } from '@/types/budget'
import type { GoalProgress } from '@/types/goal'

const FIXED_NAMES = ['住居費', '保険', '通信費', '水道光熱費', '投資']

function summaryWith(
  transactions: Array<{ id: string; amount: number; category: string; date: string }>
): BudgetSummary {
  return computeBudget({
    month: '2026-07',
    today: '2026-07-24',
    settings: {
      income_planned: 300000,
      fixed_planned: null,
      investment_target: 30000,
      savings_target: 50000,
      buffer: 10000,
      variable_budget_override: null,
    },
    fixedNames: FIXED_NAMES,
    scheduledPayments: [],
    transactions: transactions.map(t => ({ ...t, kind: 'expense' as const })),
  })
}

function ctx(overrides: Partial<CoachContext> = {}): CoachContext {
  const budget = overrides.budget ?? summaryWith([{ id: 't1', amount: 60000, category: '食費', date: '2026-07-10' }])
  return {
    today: '2026-07-24',
    categoryProgress: [],
    goals: [],
    accounts: [],
    upcomingDebits: [],
    ...overrides,
    budget,
  }
}

test('formatYen uses 万円 only for round amounts', () => {
  assert.equal(formatYen(250000), '25万円')
  assert.equal(formatYen(1000000), '100万円')
  assert.equal(formatYen(62350), '62,350円')
  assert.equal(formatYen(800), '800円')
})

// ---------------------------------------------------------------- 花形コメント

test('an upcoming debit tells the user which account to keep how much in', () => {
  const insights = buildCoachInsights(
    ctx({
      accounts: [{ id: 'smbc', name: '三井住友銀行', balance: 400000 }],
      upcomingDebits: [
        { date: '2026-07-27', name: '楽天カード', amount: 250000, accountId: 'smbc' },
      ],
    })
  )

  const debit = insights.find(i => i.type === 'upcoming_debit')
  assert.ok(debit)
  assert.equal(debit.severity, 'info')
  assert.match(debit.body, /三井住友銀行に25万円残しておくことをおすすめします/)
  assert.deepEqual(debit.payload, {
    action: 'keep_balance',
    account_id: 'smbc',
    account_name: '三井住友銀行',
    amount: 250000,
    by: '2026-07-27',
  })
})

test('debits outside the horizon are ignored', () => {
  const insights = buildCoachInsights(
    ctx({
      accounts: [{ id: 'smbc', name: '三井住友銀行', balance: 400000 }],
      upcomingDebits: [
        { date: '2026-08-27', name: '楽天カード', amount: 250000, accountId: 'smbc' },
      ],
    })
  )
  assert.equal(insights.filter(i => i.type === 'upcoming_debit').length, 0)
})

test('a shortfall becomes an actionable transfer proposal, never an execution', () => {
  const insights = buildCoachInsights(
    ctx({
      accounts: [
        { id: 'smbc', name: '三井住友銀行', balance: 200000 },
        { id: 'rakuten', name: '楽天銀行', balance: 300000 },
      ],
      upcomingDebits: [
        { date: '2026-07-27', name: '楽天カード', amount: 250000, accountId: 'smbc' },
      ],
    })
  )

  const transfer = insights.find(i => i.type === 'transfer_suggestion')
  assert.ok(transfer)
  assert.equal(transfer.severity, 'action')
  assert.deepEqual(transfer.payload, {
    action: 'propose_transfer',
    from_account_id: 'rakuten',
    from_account_name: '楽天銀行',
    to_account_id: 'smbc',
    to_account_name: '三井住友銀行',
    amount: 50000,
    by: '2026-07-27',
  })

  const debit = insights.find(i => i.type === 'upcoming_debit')
  assert.equal(debit?.severity, 'action')
})

test('with no account able to cover the shortfall it reports a cash shortfall', () => {
  const insights = buildCoachInsights(
    ctx({
      accounts: [
        { id: 'smbc', name: '三井住友銀行', balance: 10000 },
        { id: 'rakuten', name: '楽天銀行', balance: 20000 },
      ],
      upcomingDebits: [
        { date: '2026-07-27', name: '楽天カード', amount: 250000, accountId: 'smbc' },
      ],
    })
  )

  assert.ok(insights.some(i => i.type === 'cash_shortfall'))
  assert.ok(!insights.some(i => i.type === 'transfer_suggestion'))
})

// ---------------------------------------------------------------- カテゴリ

test('category_over turns the overspend into a concrete number of outings', () => {
  const budget = summaryWith([
    { id: 't1', amount: 3000, category: '外食', date: '2026-07-02' },
    { id: 't2', amount: 3000, category: '外食', date: '2026-07-09' },
    { id: 't3', amount: 4000, category: '外食', date: '2026-07-14' },
  ])
  const insights = buildCoachInsights(
    ctx({ budget, categoryProgress: computeCategoryProgress({ 外食: 8000 }, budget) })
  )

  const over = insights.find(i => i.type === 'category_over')
  assert.ok(over)
  assert.equal(over.title, '外食が2,000円超過')
  // 超過 2,000 / 平均単価 3,333 → 1 回
  assert.deepEqual(over.payload, { action: 'reduce_category', category: '外食', amount: 2000, times: 1 })
  assert.match(over.body, /外食を1回減らせば戻せます/)
})

// ---------------------------------------------------------------- 予算全体

test('a calm month yields exactly one informational on-track insight', () => {
  const budget = summaryWith([{ id: 't1', amount: 30000, category: '食費', date: '2026-07-05' }])
  const insights = buildCoachInsights(ctx({ budget }))

  assert.deepEqual(
    insights.map(i => i.type),
    ['progress_on_track']
  )
  assert.equal(selectTodaysInsight(insights)?.type, 'progress_on_track')
})

test('over budget outranks an on-track message', () => {
  // 自由予算 = 300,000 − 0(固定費なし) − 30,000 − 50,000 − 10,000 = 210,000
  const budget = summaryWith([{ id: 't1', amount: 250000, category: '食費', date: '2026-07-05' }])
  const insights = buildCoachInsights(ctx({ budget }))

  assert.equal(selectTodaysInsight(insights)?.type, 'over_budget')
  assert.ok(!insights.some(i => i.type === 'progress_on_track'))
})

// ---------------------------------------------------------------- 目標

function goalProgress(overrides: Partial<GoalProgress> = {}): GoalProgress {
  return {
    goalId: 'g1',
    title: '住宅頭金',
    kind: 'savings',
    targetAmount: 5000000,
    currentAmount: 1000000,
    remainingAmount: 4000000,
    progressRate: 0.2,
    requiredMonthly: 100000,
    monthlyPace: 40000,
    projectedAchievementMonth: '2034-11',
    monthsToTarget: 53,
    status: 'behind',
    ...overrides,
  }
}

test('goal_behind states the shortfall and the projected month', () => {
  const insights = buildCoachInsights(ctx({ goals: [goalProgress()] }))
  const behind = insights.find(i => i.type === 'goal_behind')

  assert.ok(behind)
  assert.equal(behind.title, '「住宅頭金」の積立が6万円不足')
  assert.deepEqual(behind.payload, {
    action: 'review_goal',
    goal_id: 'g1',
    required_monthly: 100000,
    monthly_pace: 40000,
  })
})

test('milestones fire at 25% steps, not every day', () => {
  const quarter = buildCoachInsights(
    ctx({ goals: [goalProgress({ status: 'on_track', progressRate: 0.26 })] })
  )
  const early = buildCoachInsights(
    ctx({ goals: [goalProgress({ status: 'on_track', progressRate: 0.12 })] })
  )

  assert.ok(quarter.some(i => i.type === 'goal_milestone'))
  assert.ok(!early.some(i => i.type === 'goal_milestone'))
})

// ---------------------------------------------------------------- 優先度

test('insights are ordered action → warning → info', () => {
  const budget = summaryWith([{ id: 't1', amount: 150000, category: '食費', date: '2026-07-05' }])
  const insights = buildCoachInsights(
    ctx({
      budget,
      goals: [goalProgress()],
      accounts: [{ id: 'smbc', name: '三井住友銀行', balance: 5000 }],
      upcomingDebits: [
        { date: '2026-07-26', name: '家賃', amount: 80000, accountId: 'smbc' },
      ],
    })
  )

  const ranks = insights.map(i => ({ action: 3, warning: 2, info: 1 })[i.severity])
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a))
  assert.equal(selectTodaysInsight(insights)?.severity, 'action')
})
