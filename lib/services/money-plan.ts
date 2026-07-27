// lib/services/money-plan.ts
//
// 「今月のお金の流れ」を1本の滝(ウォーターフォール)に組み立てる決定的エンジン。
//
//   収入 → 固定費 → 目標・ミッション → 投資 → 予備費 → 自由に使えるお金 → カテゴリ配分
//
// 要件定義書 v3.1 の「お金の流れ」をそのまま数値化したもの。
// 金額は全て lib/services/budget-engine.ts が計算済みの値を組み替えるだけで、
// ここで新しい計算式は導入しない(自由予算の定義を1箇所に保つため)。
import type { BudgetSummary, CategoryBudget } from '@/types/budget'
import type { GoalProgress } from '@/types/goal'
import type { ResolvedScheduledPayment } from '@/types/cashflow'
import { safeRatio, yen } from './money'

export type PlanBreakdown = {
  label: string
  amount: number
  /** 補足(引落口座・達成期限など) */
  note?: string
}

export type PlanStep = {
  key: 'income' | 'fixed' | 'goals' | 'investment' | 'buffer' | 'free'
  label: string
  /** 常に正の整数円。符号は sign で表す */
  amount: number
  sign: '+' | '−' | '='
  /** 収入に対する割合(0〜1)。バーの長さに使う */
  ratio: number
  breakdown: PlanBreakdown[]
}

export type CategoryPlan = {
  category: string
  budget: number
  spent: number
  remaining: number
  /** 消化率(0〜1で頭打ちにしない。1超で使いすぎ) */
  usage: number
  /** 予算が未設定のカテゴリ(実績のみ) */
  unbudgeted: boolean
}

export type MoneyPlan = {
  month: string
  steps: PlanStep[]
  /** 自由に使えるお金(= budget.variable.budget) */
  freeBudget: number
  spent: number
  remaining: number
  /** 収入に対する固定費の割合 */
  fixedRatio: number
  daysLeft: number
  dailyAllowance: number
  categories: CategoryPlan[]
}

/** 固定費をカテゴリ別に合算する。カード払いも含めた「毎月出ていく額」で見る */
export function groupFixedByCategory(payments: ResolvedScheduledPayment[]): PlanBreakdown[] {
  const totals = new Map<string, number>()

  for (const payment of payments) {
    if (!payment.is_active) continue
    if (payment.type === 'income') continue
    const amount = yen(payment.resolvedAmountYen ?? payment.amount)
    if (amount <= 0) continue // 金額未登録は流れに乗せない
    const category = payment.category || 'その他'
    totals.set(category, (totals.get(category) ?? 0) + amount)
  }

  return [...totals.entries()]
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
}

/** 目標・ミッションの毎月の積立額。逆算値(requiredMonthly)を優先する */
export function goalBreakdown(goals: GoalProgress[]): PlanBreakdown[] {
  return goals
    .filter(goal => goal.status !== 'achieved')
    .map(goal => ({
      label: goal.title,
      amount: yen(goal.requiredMonthly ?? goal.monthlyPace ?? 0),
      note: goal.projectedAchievementMonth
        ? `予測 ${goal.projectedAchievementMonth.replace('-', '年')}月`
        : undefined,
    }))
    .filter(item => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)
}

export function buildMoneyPlan(input: {
  month: string
  budget: BudgetSummary
  categoryBudgets: CategoryBudget[]
  fixedPayments: ResolvedScheduledPayment[]
  goals: GoalProgress[]
}): MoneyPlan {
  const { month, budget, categoryBudgets, fixedPayments, goals } = input

  const income = yen(budget.income.planned)
  const fixed = yen(budget.fixed.effective)
  const savings = yen(budget.savings.target)
  const investment = yen(budget.investment.target)
  const buffer = yen(budget.buffer)
  const free = yen(budget.variable.budget)

  const ratioOf = (amount: number) => safeRatio(amount, income, 0)

  const steps: PlanStep[] = [
    {
      key: 'income',
      label: '収入',
      amount: income,
      sign: '+',
      ratio: 1,
      breakdown: [],
    },
    {
      key: 'fixed',
      label: '固定費',
      amount: fixed,
      sign: '−',
      ratio: ratioOf(fixed),
      breakdown: groupFixedByCategory(fixedPayments),
    },
    {
      key: 'goals',
      label: '目標・ミッション',
      amount: savings,
      sign: '−',
      ratio: ratioOf(savings),
      breakdown: goalBreakdown(goals),
    },
    {
      key: 'investment',
      label: '投資',
      amount: investment,
      sign: '−',
      ratio: ratioOf(investment),
      breakdown: [],
    },
    {
      key: 'buffer',
      label: '予備費',
      amount: buffer,
      sign: '−',
      ratio: ratioOf(buffer),
      breakdown: [],
    },
    {
      key: 'free',
      label: '自由に使えるお金',
      amount: free,
      sign: '=',
      ratio: ratioOf(free),
      breakdown: [],
    },
  ]

  return {
    month,
    // 金額0のステップ(投資・予備費が未設定など)は流れから省いて見やすくする。
    // ただし収入と自由予算は0でも常に出す(0であること自体が情報のため)。
    steps: steps.filter(step => step.amount > 0 || step.key === 'income' || step.key === 'free'),
    freeBudget: free,
    spent: yen(budget.variable.spent),
    remaining: yen(budget.variable.remaining),
    fixedRatio: ratioOf(fixed),
    daysLeft: budget.variable.daysLeft,
    dailyAllowance: yen(budget.variable.dailyAllowance),
    categories: buildCategoryPlans(budget, categoryBudgets),
  }
}

/** 変動費のカテゴリ別配分。予算があるものを先に、次に予算外の実績を出す */
export function buildCategoryPlans(
  budget: BudgetSummary,
  categoryBudgets: CategoryBudget[]
): CategoryPlan[] {
  const spentByCategory = budget.variable.byCategory ?? {}
  const budgeted = new Map(categoryBudgets.map(item => [item.category, yen(item.amount)]))

  const plans: CategoryPlan[] = []

  for (const [category, amount] of budgeted) {
    const spent = yen(spentByCategory[category] ?? 0)
    plans.push({
      category,
      budget: amount,
      spent,
      remaining: amount - spent,
      usage: safeRatio(spent, amount, 0),
      unbudgeted: false,
    })
  }

  // 予算枠が無いのに使っているカテゴリ。見落とすと「自由予算が合わない」原因になる
  for (const [category, rawSpent] of Object.entries(spentByCategory)) {
    if (budgeted.has(category)) continue
    const spent = yen(rawSpent)
    if (spent <= 0) continue
    plans.push({
      category,
      budget: 0,
      spent,
      remaining: -spent,
      usage: 1,
      unbudgeted: true,
    })
  }

  return plans.sort((a, b) => {
    if (a.unbudgeted !== b.unbudgeted) return a.unbudgeted ? 1 : -1
    return b.budget - a.budget || b.spent - a.spent
  })
}
