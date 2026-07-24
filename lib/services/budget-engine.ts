// lib/services/budget-engine.ts
//
// 予算の「決定的エンジン」。docs/v2-ai-coach-spec.md の核心原則どおり、
// お金に関わる数字は全てここ(純関数)で計算し、LLM には一切計算させない。
// 副作用ゼロ・入力は全て引数(「今日」も引数)なので、数値の正しさをテストで担保できる。
//
//   自由予算 = 収入 − 固定費(予定と実績の突合後) − 投資目標 − 貯蓄目標 − 予備費
//
import type {
  BudgetAlert,
  BudgetInput,
  BudgetScheduledPayment,
  BudgetSummary,
  BudgetTransaction,
  CategoryBudget,
  CategoryProgress,
  CategoryStat,
  FixedItem,
  FixedItemStatus,
} from '@/types/budget'
import { allocateByRatio, nonNegativeYen, safeRatio, yen } from './money'

/** 履歴が薄いユーザー向けの既定配分。合計 1.0。 */
export const TEMPLATE_CATEGORY_RATIOS: Record<string, number> = {
  食費: 0.34,
  外食: 0.12,
  日用品: 0.09,
  交通費: 0.08,
  娯楽: 0.12,
  カフェ: 0.04,
  美容: 0.05,
  健康: 0.03,
  医療: 0.03,
  その他: 0.10,
}

/** 変動費枠の消化に含めないカテゴリ(固定費カテゴリとは別に常に除外する) */
const ALWAYS_EXCLUDED_CATEGORIES = ['クレカ請求', '未分類']

// ---------------------------------------------------------------- 日付ヘルパ
// タイムゾーン事故を避けるため、日付は文字列のまま扱う(YYYY-MM-DD は辞書順 = 時系列順)。

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number)
  if (!year || !monthNumber) return 30
  return new Date(year, monthNumber, 0).getDate()
}

/**
 * その月のうち何日経過したか(当日を含む)。
 * 過去の月なら満了、未来の月なら 0。
 */
export function elapsedDays(month: string, today: string): number {
  const total = daysInMonth(month)
  const currentMonth = monthOf(today)
  if (currentMonth > month) return total
  if (currentMonth < month) return 0
  return Math.min(Number(today.slice(8, 10)) || 1, total)
}

// ---------------------------------------------------------------- 固定費の突合
// docs/budget-design.md の突合ロジック。予定 1 件に対し当月の取引 1 件を割り当てる(1対1)。

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（）()]/g, '')
}

function nameMatches(payment: BudgetScheduledPayment, tx: BudgetTransaction) {
  const target = normalizeName(payment.name)
  if (target.length === 0) return false
  const haystacks = [tx.memo ?? '', tx.payment_method ?? '', tx.category ?? '']
    .map(normalizeName)
    .filter(value => value.length > 0)
  return haystacks.some(value => value.includes(target) || target.includes(value))
}

function amountMatches(planned: number, actual: number) {
  const ratioTolerance = Math.abs(planned) * 0.2
  const flatTolerance = 3000
  return Math.abs(actual - planned) <= Math.max(ratioTolerance, flatTolerance)
}

function statusForMatched(planned: number, actual: number): FixedItemStatus {
  const tolerance = Math.max(Math.abs(planned) * 0.05, 1000)
  if (Math.abs(actual - planned) <= tolerance) return 'paid'
  return actual > planned ? 'over' : 'under'
}

function statusForUnmatched(dueDay: number, month: string, today: string): FixedItemStatus {
  const currentMonth = monthOf(today)
  if (currentMonth < month) return 'unpaid'
  if (currentMonth > month) return 'missing'
  const effectiveDueDay = Math.min(dueDay, daysInMonth(month))
  return Number(today.slice(8, 10)) <= effectiveDueDay ? 'unpaid' : 'missing'
}

export function matchFixedPayments(
  payments: BudgetScheduledPayment[],
  transactions: BudgetTransaction[],
  options: { month: string; today: string; fixedNames: string[] }
): FixedItem[] {
  const { month, today, fixedNames } = options
  const fixedNameSet = new Set(fixedNames)
  const activeFixed = payments.filter(p => p.is_active && p.type === 'fixed')

  const candidates = transactions.filter(
    tx => tx.kind === 'expense' && monthOf(tx.date) === month
  )
  const claimed = new Set<string>()

  // 手動紐付け(transactions.scheduled_payment_id)は自動判定より優先する。
  const manualByPayment = new Map<string, BudgetTransaction>()
  for (const tx of candidates) {
    if (!tx.scheduled_payment_id) continue
    if (manualByPayment.has(tx.scheduled_payment_id)) continue
    manualByPayment.set(tx.scheduled_payment_id, tx)
    claimed.add(tx.id)
  }

  return activeFixed.map<FixedItem>(payment => {
    const planned = yen(payment.amount)
    const manual = manualByPayment.get(payment.id)

    const matched =
      manual ??
      pickBestCandidate(
        candidates.filter(
          tx =>
            !claimed.has(tx.id) &&
            !tx.scheduled_payment_id &&
            fixedNameSet.has(tx.category) &&
            nameMatches(payment, tx) &&
            amountMatches(planned, yen(tx.amount))
        ),
        planned,
        payment.due_day
      )

    if (!matched) {
      return {
        id: payment.id,
        name: payment.name,
        due_day: payment.due_day,
        planned,
        actual: null,
        status: statusForUnmatched(payment.due_day, month, today),
        matched_transaction_id: null,
        effective: planned,
      }
    }

    claimed.add(matched.id)
    const actual = yen(matched.amount)
    return {
      id: payment.id,
      name: payment.name,
      due_day: payment.due_day,
      planned,
      actual,
      status: statusForMatched(planned, actual),
      matched_transaction_id: matched.id,
      effective: actual,
    }
  })
}

/** 金額差が最小 → 日付が due_day に近い順で 1 件選ぶ */
function pickBestCandidate(
  candidates: BudgetTransaction[],
  planned: number,
  dueDay: number
): BudgetTransaction | null {
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => {
    const amountDiff =
      Math.abs(yen(a.amount) - planned) - Math.abs(yen(b.amount) - planned)
    if (amountDiff !== 0) return amountDiff
    const dayDiff =
      Math.abs(Number(a.date.slice(8, 10)) - dueDay) -
      Math.abs(Number(b.date.slice(8, 10)) - dueDay)
    if (dayDiff !== 0) return dayDiff
    return a.id < b.id ? -1 : 1
  })[0]
}

// ---------------------------------------------------------------- 変動費の実績

export function summarizeVariableSpending(
  transactions: BudgetTransaction[],
  options: { month: string; fixedNames: string[]; excludeTransactionIds?: Iterable<string> }
): { total: number; byCategory: Record<string, number>; stats: Record<string, CategoryStat> } {
  const fixedNameSet = new Set(options.fixedNames)
  const excluded = new Set(options.excludeTransactionIds ?? [])
  const byCategory: Record<string, number> = {}
  const stats: Record<string, CategoryStat> = {}
  let total = 0

  for (const tx of transactions) {
    if (tx.kind !== 'expense') continue
    if (monthOf(tx.date) !== options.month) continue
    if (excluded.has(tx.id)) continue
    if (tx.scheduled_payment_id) continue
    if (fixedNameSet.has(tx.category)) continue
    if (ALWAYS_EXCLUDED_CATEGORIES.includes(tx.category)) continue

    const amount = yen(tx.amount)
    total += amount
    byCategory[tx.category] = (byCategory[tx.category] ?? 0) + amount
    const stat = stats[tx.category] ?? { total: 0, count: 0, average: 0 }
    stat.total += amount
    stat.count += 1
    stat.average = Math.round(stat.total / stat.count)
    stats[tx.category] = stat
  }

  return { total, byCategory, stats }
}

// ---------------------------------------------------------------- 主計算

export function computeBudget(input: BudgetInput): BudgetSummary {
  const { month, today, settings, fixedNames, scheduledPayments, transactions } = input

  const items = matchFixedPayments(scheduledPayments, transactions, {
    month,
    today,
    fixedNames,
  })

  const fixedPlanned =
    settings.fixed_planned !== null && settings.fixed_planned !== undefined
      ? nonNegativeYen(settings.fixed_planned)
      : items.reduce((sum, item) => sum + item.planned, 0)
  const fixedPaid = items
    .filter(item => item.actual !== null)
    .reduce((sum, item) => sum + item.effective, 0)
  const fixedUnpaid = items
    .filter(item => item.actual === null)
    .reduce((sum, item) => sum + item.effective, 0)
  const fixedEffective = fixedPaid + fixedUnpaid

  const incomePlanned = nonNegativeYen(
    settings.income_planned ?? input.fallbackIncome ?? 0
  )
  const incomeActual = transactions
    .filter(tx => tx.kind === 'income' && monthOf(tx.date) === month)
    .reduce((sum, tx) => sum + yen(tx.amount), 0)

  const investmentTarget = nonNegativeYen(settings.investment_target)
  const savingsTarget = nonNegativeYen(settings.savings_target)
  const buffer = nonNegativeYen(settings.buffer)

  const derivedBudget =
    incomePlanned - fixedEffective - investmentTarget - savingsTarget - buffer
  const variableBudget =
    settings.variable_budget_override !== null &&
    settings.variable_budget_override !== undefined
      ? nonNegativeYen(settings.variable_budget_override)
      : Math.max(derivedBudget, 0)

  const matchedIds = items
    .map(item => item.matched_transaction_id)
    .filter((id): id is string => Boolean(id))
  const spending = summarizeVariableSpending(transactions, {
    month,
    fixedNames,
    excludeTransactionIds: matchedIds,
  })

  const totalDays = daysInMonth(month)
  const daysElapsed = elapsedDays(month, today)
  const daysLeft = Math.max(totalDays - daysElapsed + 1, 0)
  const remaining = variableBudget - spending.total
  const dailyAllowance = daysLeft > 0 ? Math.floor(Math.max(remaining, 0) / daysLeft) : 0

  // ペース: 経過日数どおりに使っていれば 1.0。1.0 超で使いすぎ傾向。
  const expectedSpend = variableBudget * safeRatio(daysElapsed, totalDays)
  const pace = expectedSpend > 0 ? spending.total / expectedSpend : 0

  const summary: BudgetSummary = {
    month,
    income: { planned: incomePlanned, actual: incomeActual },
    fixed: {
      planned: fixedPlanned,
      paid: fixedPaid,
      unpaid: fixedUnpaid,
      effective: fixedEffective,
      items,
    },
    investment: { target: investmentTarget },
    savings: { target: savingsTarget },
    buffer,
    variable: {
      budget: variableBudget,
      spent: spending.total,
      remaining,
      daysInMonth: totalDays,
      daysElapsed,
      daysLeft,
      dailyAllowance,
      pace: Math.round(pace * 100) / 100,
      byCategory: spending.byCategory,
      categoryStats: spending.stats,
    },
    alerts: [],
  }

  summary.alerts = buildBudgetAlerts(summary)
  return summary
}

export function buildBudgetAlerts(summary: BudgetSummary): BudgetAlert[] {
  const alerts: BudgetAlert[] = []

  if (summary.income.planned <= 0) {
    alerts.push({
      type: 'income_missing',
      severity: 'warning',
      message: '月収の見込みが未設定です。予算を計算するために設定してください。',
    })
  }
  if (summary.variable.remaining < 0) {
    alerts.push({
      type: 'over_budget',
      severity: 'action',
      message: `変動費が予算を ${Math.abs(summary.variable.remaining).toLocaleString()}円 超えています。`,
    })
  } else if (summary.variable.pace > 1.15) {
    alerts.push({
      type: 'pace_high',
      severity: 'warning',
      message: `このペースだと月末に予算を超えます(ペース ${summary.variable.pace.toFixed(2)})。`,
    })
  }

  const missing = summary.fixed.items.filter(item => item.status === 'missing')
  if (missing.length > 0) {
    alerts.push({
      type: 'fixed_missing',
      severity: 'warning',
      message: `支払日を過ぎている固定費が ${missing.length}件 あります(${missing
        .map(item => item.name)
        .join('・')})。`,
    })
  }

  return alerts
}

// ---------------------------------------------------------------- カテゴリ配分

/**
 * 自由予算をカテゴリ別サブ枠に配分する。
 * MVP は「過去実績の比率 × 自由予算」。実績が薄ければテンプレート比率にフォールバック。
 * LLM は使わない(スペック §2 Phase2)。
 */
export function allocateCategoryBudgets(
  freeBudget: number,
  historyByCategory: Record<string, number>,
  options: { minimumHistoryTotal?: number; template?: Record<string, number> } = {}
): CategoryBudget[] {
  const template = options.template ?? TEMPLATE_CATEGORY_RATIOS
  const minimumHistoryTotal = options.minimumHistoryTotal ?? 10000

  const historyTotal = Object.values(historyByCategory).reduce(
    (sum, value) => sum + Math.max(yen(value), 0),
    0
  )
  const useHistory = historyTotal >= minimumHistoryTotal
  const weights = useHistory
    ? Object.fromEntries(
        Object.entries(historyByCategory).map(([key, value]) => [key, Math.max(yen(value), 0)])
      )
    : template

  const allocated = allocateByRatio(nonNegativeYen(freeBudget), weights)
  return Object.entries(allocated)
    .map<CategoryBudget>(([category, amount]) => ({
      category,
      amount,
      source: useHistory ? 'history' : 'template',
    }))
    .sort((a, b) => b.amount - a.amount)
}

/** カテゴリ別サブ枠 × 実績 → 進捗バーに出す形 */
export function computeCategoryProgress(
  categoryBudgets: Record<string, number>,
  summary: BudgetSummary
): CategoryProgress[] {
  const categories = new Set([
    ...Object.keys(categoryBudgets),
    ...Object.keys(summary.variable.byCategory),
  ])
  const dayRatio = safeRatio(summary.variable.daysElapsed, summary.variable.daysInMonth)

  return [...categories]
    .map<CategoryProgress>(category => {
      const budget = nonNegativeYen(categoryBudgets[category] ?? 0)
      const spent = yen(summary.variable.byCategory[category] ?? 0)
      const stat = summary.variable.categoryStats[category]
      const expected = budget * dayRatio
      return {
        category,
        budget,
        spent,
        remaining: budget - spent,
        rate: Math.round(safeRatio(spent, budget) * 100) / 100,
        pace: expected > 0 ? Math.round((spent / expected) * 100) / 100 : 0,
        average: stat?.average ?? 0,
        count: stat?.count ?? 0,
      }
    })
    .sort((a, b) => b.spent - a.spent)
}
