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
  /** 生活固定費（積立投資を含まない） */
  livingFixed: number
  /** 毎月の積立投資 */
  investmentFixed: number
  /** 固定支出合計 = 生活固定費 + 積立投資 */
  totalFixed: number
  /** 収入が未登録。true のときは金額ではなく「収入を登録してください」を出す */
  incomeMissing: boolean
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

/**
 * 積立投資のカテゴリ。生活固定費とは別枠で集計する。
 *
 * 積立NISA を「固定費」と「投資」の両方に数えると、収入から二重に引かれて
 * 自由に使える額が実態より少なく出る。片方だけに置くこと。
 */
const INVESTMENT_CATEGORY = '投資'

/** 積立投資か。カテゴリだけで判定し、名前からは推測しない */
export function isInvestmentPayment(payment: ResolvedScheduledPayment): boolean {
  return payment.category === INVESTMENT_CATEGORY
}

/**
 * カード請求そのもの（type: 'credit'）は家計の支出に足さない。
 *
 * 電気代2,000円をカードで払うと、電気代が固定費として1回計上され、
 * 翌月そのカードの請求として銀行から引き落とされる。請求は同じ支出の決済なので、
 * ここで足すと二重計上になる。カード請求はキャッシュフロー上の口座引落として
 * だけ使い、支出カテゴリの集計には入れない（要件 §11）。
 */
function isCardBill(payment: ResolvedScheduledPayment): boolean {
  return payment.type === 'credit'
}

/**
 * 固定費をカテゴリ別に合算する。カード払いも含めた「毎月出ていく額」で見る。
 * 積立投資は生活固定費に混ぜないので、既定では除外する。
 */
export function groupFixedByCategory(
  payments: ResolvedScheduledPayment[],
  options: { includeInvestment?: boolean } = {}
): PlanBreakdown[] {
  const totals = new Map<string, number>()

  for (const payment of payments) {
    if (!payment.is_active) continue
    if (payment.type === 'income') continue
    if (isCardBill(payment)) continue
    if (!options.includeInvestment && isInvestmentPayment(payment)) continue
    const amount = yen(payment.resolvedAmountYen ?? payment.amount)
    if (amount <= 0) continue // 金額未登録は流れに乗せない
    const category = payment.category || 'その他'
    totals.set(category, (totals.get(category) ?? 0) + amount)
  }

  return [...totals.entries()]
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
}

/** 生活固定費の合計（積立投資を含まない） */
export function sumLivingFixed(payments: ResolvedScheduledPayment[]): number {
  return groupFixedByCategory(payments).reduce((sum, item) => sum + item.amount, 0)
}

/** 毎月の積立投資の合計 */
export function sumInvestmentFixed(payments: ResolvedScheduledPayment[]): number {
  return payments
    .filter(
      payment =>
        payment.is_active &&
        payment.type !== 'income' &&
        !isCardBill(payment) &&
        isInvestmentPayment(payment)
    )
    .reduce((sum, payment) => sum + Math.max(yen(payment.resolvedAmountYen ?? payment.amount), 0), 0)
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
  // 生活固定費と積立投資を分ける。budget.fixed.effective は両方を含むので、
  // 投資ぶんを引いて「生活固定費」にし、投資は投資のステップで1回だけ引く。
  //
  // 前提: fixedPayments と budget.fixed.items は同じ scheduled_payments 集合であること。
  // 引き算にしているのは、effective が「予定と実績の突合後」の額だから。
  // 単純に fixedPayments を合計すると、支払済みの実額ではなく予定額に戻ってしまう。
  const investmentFromFixed = sumInvestmentFixed(fixedPayments)
  const fixed = Math.max(yen(budget.fixed.effective) - investmentFromFixed, 0)
  const savings = yen(budget.savings.target)
  // budget.investment.target と固定費側の積立が両方あると二重に引かれるため、
  // 固定費として登録済みならそちらを正とする。
  const investment = investmentFromFixed > 0
    ? investmentFromFixed
    : yen(budget.investment.target)
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
      breakdown: groupFixedByCategory(fixedPayments),  // 積立投資は含まない
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
    livingFixed: fixed,
    investmentFixed: investment,
    // 生活固定費 + 積立投資。画面ではこの内訳も併せて出す
    totalFixed: fixed + investment,
    // 収入が未登録なら「0円しか使えない」ではなく「まだ計算できない」。
    // 0円として赤字表示すると、設定漏れが破綻に見えてしまう。
    incomeMissing: income <= 0,
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
