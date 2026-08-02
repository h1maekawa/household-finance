import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allocateCategoryBudgets,
  computeBudget,
  computeCategoryProgress,
  daysInMonth,
  elapsedDays,
  matchFixedPayments,
  summarizeVariableSpending,
} from '@/lib/services/budget-engine'
import type {
  BudgetInput,
  BudgetScheduledPayment,
  BudgetTransaction,
} from '@/types/budget'

const FIXED_NAMES = ['住居費', '保険', '通信費', '水道光熱費', '投資']

function tx(partial: Partial<BudgetTransaction> & { id: string; amount: number }): BudgetTransaction {
  return {
    date: '2026-07-10',
    category: '食費',
    kind: 'expense',
    ...partial,
  }
}

function fixed(
  partial: Partial<BudgetScheduledPayment> & { id: string; name: string; amount: number }
): BudgetScheduledPayment {
  return {
    due_day: 26,
    category: '住居費',
    type: 'fixed',
    is_active: true,
    ...partial,
  }
}

// ---------------------------------------------------------------- 日付

test('daysInMonth handles 28/30/31 day months and leap years', () => {
  assert.equal(daysInMonth('2026-07'), 31)
  assert.equal(daysInMonth('2026-06'), 30)
  assert.equal(daysInMonth('2026-02'), 28)
  assert.equal(daysInMonth('2028-02'), 29)
})

test('elapsedDays counts the current day, and saturates for past/future months', () => {
  assert.equal(elapsedDays('2026-07', '2026-07-24'), 24)
  assert.equal(elapsedDays('2026-06', '2026-07-24'), 30) // 過去の月は満了
  assert.equal(elapsedDays('2026-08', '2026-07-24'), 0)  // 未来の月は 0
})

// ---------------------------------------------------------------- 固定費突合

test('matchFixedPayments matches by name and amount tolerance', () => {
  const payments = [fixed({ id: 'p1', name: '家賃', amount: 80000 })]
  const transactions = [
    tx({ id: 't1', amount: 80000, category: '住居費', memo: '家賃 7月分', date: '2026-07-26' }),
    tx({ id: 't2', amount: 4200, category: '食費', memo: 'スーパー' }),
  ]

  const [item] = matchFixedPayments(payments, transactions, {
    month: '2026-07',
    today: '2026-07-28',
    fixedNames: FIXED_NAMES,
  })

  assert.equal(item.status, 'paid')
  assert.equal(item.matched_transaction_id, 't1')
  assert.equal(item.effective, 80000)
})

test('matchFixedPayments flags over/under when the actual deviates', () => {
  const payments = [fixed({ id: 'p1', name: '電気代', amount: 10000, category: '水道光熱費' })]
  const transactions = [
    tx({ id: 't1', amount: 11500, category: '水道光熱費', memo: '電気代', date: '2026-07-26' }),
  ]

  const [item] = matchFixedPayments(payments, transactions, {
    month: '2026-07',
    today: '2026-07-28',
    fixedNames: FIXED_NAMES,
  })

  assert.equal(item.status, 'over')
  assert.equal(item.actual, 11500)
  assert.equal(item.effective, 11500) // 枠の計算には実額を使う
})

test('matchFixedPayments never assigns one transaction to two payments', () => {
  const payments = [
    fixed({ id: 'p1', name: '家賃', amount: 80000 }),
    fixed({ id: 'p2', name: '家賃', amount: 80000 }),
  ]
  const transactions = [
    tx({ id: 't1', amount: 80000, category: '住居費', memo: '家賃', date: '2026-07-26' }),
  ]

  const items = matchFixedPayments(payments, transactions, {
    month: '2026-07',
    today: '2026-07-28',
    fixedNames: FIXED_NAMES,
  })

  const matchedIds = items.map(item => item.matched_transaction_id).filter(Boolean)
  assert.deepEqual(matchedIds, ['t1'])
  assert.equal(items[1].status, 'missing')
})

test('a manual scheduled_payment_id link beats the automatic match', () => {
  const payments = [fixed({ id: 'p1', name: '家賃', amount: 80000 })]
  const transactions = [
    tx({ id: 'auto', amount: 80000, category: '住居費', memo: '家賃', date: '2026-07-26' }),
    tx({ id: 'manual', amount: 72000, category: '住居費', memo: '不動産振込', date: '2026-07-25', scheduled_payment_id: 'p1' }),
  ]

  const [item] = matchFixedPayments(payments, transactions, {
    month: '2026-07',
    today: '2026-07-28',
    fixedNames: FIXED_NAMES,
  })

  assert.equal(item.matched_transaction_id, 'manual')
  assert.equal(item.effective, 72000)
})

test('unmatched fixed costs are unpaid before the due day and missing after', () => {
  const payments = [fixed({ id: 'p1', name: '家賃', amount: 80000, due_day: 26 })]

  const before = matchFixedPayments(payments, [], {
    month: '2026-07', today: '2026-07-24', fixedNames: FIXED_NAMES,
  })
  const after = matchFixedPayments(payments, [], {
    month: '2026-07', today: '2026-07-28', fixedNames: FIXED_NAMES,
  })

  assert.equal(before[0].status, 'unpaid')
  assert.equal(after[0].status, 'missing')
  assert.equal(before[0].effective, 80000) // 未払いは予定額を使う
})

// ---------------------------------------------------------------- 変動費

test('summarizeVariableSpending excludes fixed categories and matched transactions', () => {
  const transactions = [
    tx({ id: 't1', amount: 4200, category: '食費' }),
    tx({ id: 't2', amount: 1800, category: '外食' }),
    tx({ id: 't3', amount: 3000, category: '食費' }),
    tx({ id: 't4', amount: 80000, category: '住居費' }),      // 固定費カテゴリ
    tx({ id: 't5', amount: 62000, category: 'クレカ請求' }),   // 二重計上防止
    tx({ id: 't6', amount: 300000, category: '給与', kind: 'income' }),
    tx({ id: 't7', amount: 5000, category: '食費', date: '2026-06-30' }), // 別の月
  ]

  const result = summarizeVariableSpending(transactions, {
    month: '2026-07',
    fixedNames: FIXED_NAMES,
  })

  assert.equal(result.total, 9000)
  assert.deepEqual(result.byCategory, { 食費: 7200, 外食: 1800 })
  assert.equal(result.stats['食費'].count, 2)
  assert.equal(result.stats['食費'].average, 3600)
})

// Gmail 取り込みは category='未分類' で入り、ユーザーが確定するまでそのまま。
// ここを除外すると「実際は使っているのに消化額0円」になり、
// 「あといくら使えるか」が実態より大きく出てしまう。
test('summarizeVariableSpending counts 未分類 so the remaining budget stays honest', () => {
  const transactions = [
    tx({ id: 't1', amount: 4200, category: '食費' }),
    tx({ id: 't2', amount: 21700, category: '未分類' }),
    tx({ id: 't3', amount: 62000, category: 'クレカ請求' }), // これは引き続き除外
  ]

  const result = summarizeVariableSpending(transactions, {
    month: '2026-07',
    fixedNames: FIXED_NAMES,
  })

  assert.equal(result.total, 25900)
  assert.deepEqual(result.byCategory, { 食費: 4200, 未分類: 21700 })
})

// ---------------------------------------------------------------- 主計算

function baseInput(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return {
    month: '2026-07',
    today: '2026-07-16', // 31日中16日経過 = ちょうど半月強
    settings: {
      income_planned: 300000,
      fixed_planned: null,
      investment_target: 30000,
      savings_target: 50000,
      buffer: 10000,
      variable_budget_override: null,
    },
    fixedNames: FIXED_NAMES,
    scheduledPayments: [fixed({ id: 'p1', name: '家賃', amount: 80000, due_day: 26 })],
    transactions: [],
    ...overrides,
  }
}

test('computeBudget derives the free budget from the spec formula', () => {
  const summary = computeBudget(baseInput())

  // 300,000 − 80,000(未払いは予定額) − 30,000 − 50,000 − 10,000 = 130,000
  assert.equal(summary.variable.budget, 130000)
  assert.equal(summary.fixed.effective, 80000)
  assert.equal(summary.fixed.unpaid, 80000)
  assert.equal(summary.fixed.paid, 0)
})

test('computeBudget never returns a negative budget, and override wins', () => {
  const broke = computeBudget(
    baseInput({ settings: { ...baseInput().settings, income_planned: 50000 } })
  )
  assert.equal(broke.variable.budget, 0)

  const overridden = computeBudget(
    baseInput({ settings: { ...baseInput().settings, variable_budget_override: 90000 } })
  )
  assert.equal(overridden.variable.budget, 90000)
})

test('computeBudget computes remaining, daily allowance and pace', () => {
  const summary = computeBudget(
    baseInput({
      transactions: [
        tx({ id: 't1', amount: 40000, category: '食費', date: '2026-07-05' }),
        tx({ id: 't2', amount: 25000, category: '外食', date: '2026-07-12' }),
      ],
    })
  )

  assert.equal(summary.variable.spent, 65000)
  assert.equal(summary.variable.remaining, 65000)
  assert.equal(summary.variable.daysElapsed, 16)
  assert.equal(summary.variable.daysLeft, 16) // 31 − 16 + 1(当日を含む)
  assert.equal(summary.variable.dailyAllowance, Math.floor(65000 / 16))

  // 期待消化 = 130,000 × 16/31 = 67,096.7 → 65,000 / 67,096.7 ≒ 0.97
  assert.equal(summary.variable.pace, 0.97)
})

test('computeBudget raises over_budget and pace_high alerts', () => {
  const over = computeBudget(
    baseInput({ transactions: [tx({ id: 't1', amount: 150000, date: '2026-07-10' })] })
  )
  assert.equal(over.variable.remaining, -20000)
  assert.ok(over.alerts.some(a => a.type === 'over_budget' && a.severity === 'action'))

  const fast = computeBudget(
    baseInput({ transactions: [tx({ id: 't1', amount: 100000, date: '2026-07-10' })] })
  )
  assert.ok(fast.variable.pace > 1.15)
  assert.ok(fast.alerts.some(a => a.type === 'pace_high'))
  assert.ok(!fast.alerts.some(a => a.type === 'over_budget'))
})

test('computeBudget counts the actual amount for paid fixed costs', () => {
  const summary = computeBudget(
    baseInput({
      today: '2026-07-28',
      transactions: [
        tx({ id: 't1', amount: 85000, category: '住居費', memo: '家賃', date: '2026-07-26' }),
      ],
    })
  )

  // 実額 85,000 が枠から引かれる: 300,000 − 85,000 − 30,000 − 50,000 − 10,000
  assert.equal(summary.fixed.paid, 85000)
  assert.equal(summary.variable.budget, 125000)
  // 固定費として突合された取引は変動費の消化に含めない(二重計上防止)
  assert.equal(summary.variable.spent, 0)
})

// ---------------------------------------------------------------- カテゴリ配分

test('allocateCategoryBudgets splits by past ratios and the total matches exactly', () => {
  const allocated = allocateCategoryBudgets(130000, { 食費: 60000, 外食: 30000, 娯楽: 10000 })
  const total = allocated.reduce((sum, c) => sum + c.amount, 0)

  assert.equal(total, 130000)
  assert.equal(allocated[0].category, '食費')
  assert.equal(allocated[0].source, 'history')
  assert.equal(allocated[0].amount, 78000) // 130,000 × 60/100
})

test('allocateCategoryBudgets falls back to the template when history is thin', () => {
  const allocated = allocateCategoryBudgets(100000, { 食費: 500 })
  const total = allocated.reduce((sum, c) => sum + c.amount, 0)

  assert.equal(total, 100000)
  assert.equal(allocated[0].source, 'template')
  assert.ok(allocated.length > 1)
})

test('computeCategoryProgress reports per-category pace and average ticket', () => {
  const summary = computeBudget(
    baseInput({
      transactions: [
        tx({ id: 't1', amount: 3000, category: '外食', date: '2026-07-02' }),
        tx({ id: 't2', amount: 3000, category: '外食', date: '2026-07-09' }),
        tx({ id: 't3', amount: 4000, category: '外食', date: '2026-07-14' }),
      ],
    })
  )

  const [gaishoku] = computeCategoryProgress({ 外食: 8000 }, summary)

  assert.equal(gaishoku.category, '外食')
  assert.equal(gaishoku.spent, 10000)
  assert.equal(gaishoku.remaining, -2000)
  assert.equal(gaishoku.average, 3333)
  assert.equal(gaishoku.count, 3)
  assert.ok(gaishoku.pace > 1)
})
