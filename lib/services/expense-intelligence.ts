// lib/services/expense-intelligence.ts
//
// カテゴリ単位の支出分析と「見直し候補」の抽出。純関数。
//
// 「削るべき」とは言わない。何にいくら使っていて、どこが平常と違うかを示し、
// 判断はユーザーに委ねる。価値タグ（必須/改善可能/楽しみ/見直し候補）は
// ユーザー設定が正で、システムが勝手に決めない。
//
// 増加のしきい値はここが唯一の定義。UIやAPIへ 1.05 / 1.15 を書き写さない。
import { yen } from './money'

/** ユーザー自身が決める、その支出の位置づけ。未設定は null */
export const VALUE_TAGS = ['essential', 'flexible', 'enjoyment', 'review'] as const
export type ValueTag = (typeof VALUE_TAGS)[number]

export const VALUE_TAG_LABEL: Record<ValueTag, string> = {
  essential: '必須',
  flexible: '改善可能',
  enjoyment: '楽しみ',
  review: '見直し候補',
}

export function isValueTag(value: unknown): value is ValueTag {
  return typeof value === 'string' && (VALUE_TAGS as readonly string[]).includes(value)
}

/**
 * 増加とみなすしきい値。
 * 固定費は毎月ほぼ同額なので少しの増加でも意味があり、変動費は振れ幅が
 * 大きいので広く取る。/api/analysis/fixed-variable と同じ値。
 */
export const FIXED_INCREASE_RATIO = 1.05
export const VARIABLE_INCREASE_RATIO = 1.15

export type ExpenseTrendState = 'flat' | 'increased' | 'decreased'

/** 前月や平均に対してどう動いたか。比較対象が0のときは判定しない */
export function getExpenseTrendState(
  current: number,
  baseline: number,
  options: { isFixed?: boolean } = {}
): ExpenseTrendState {
  if (baseline <= 0) return 'flat'
  const ratio = options.isFixed ? FIXED_INCREASE_RATIO : VARIABLE_INCREASE_RATIO
  if (current > baseline * ratio) return 'increased'
  if (current < baseline / ratio) return 'decreased'
  return 'flat'
}

/** 見直し候補に挙がった理由。複数該当しうる */
export type ReviewReason =
  | 'over_budget'
  | 'increased_from_previous_month'
  | 'above_three_month_average'
  | 'tagged_for_review'

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  over_budget: '予算を超えています',
  increased_from_previous_month: '先月より増えています',
  above_three_month_average: '3ヶ月平均より増えています',
  tagged_for_review: '見直し候補に設定しています',
}

export type CategoryExpense = {
  category: string
  currentMonth: number
  previousMonth: number
  threeMonthAverage: number
  /** 予算未設定なら null。0円の予算とは区別する */
  budget: number | null
  /** 予算 - 実績。マイナスなら超過。予算未設定なら null */
  budgetDifference: number | null
  previousMonthDifference: number
  averageDifference: number
  /** 今月の実績を12倍した年間換算 */
  annualized: number
  transactionCount: number
  isFixed: boolean
  /** ユーザーが設定していなければ null */
  valueTag: ValueTag | null
  candidateReason: ReviewReason[]
  /** 理由が1つ以上あるか */
  reviewCandidate: boolean
}

export type ExpenseIntelligenceInput = {
  /** 今月のカテゴリ別実績 */
  currentMonth: Record<string, number>
  previousMonth: Record<string, number>
  /** 直近3ヶ月のカテゴリ別合計（平均はここから割る） */
  threeMonthTotal: Record<string, number>
  /** カテゴリ別の取引件数（今月） */
  transactionCount: Record<string, number>
  /** カテゴリ別の予算。未設定のカテゴリは持たない */
  budgets: Record<string, number>
  /** ユーザーが設定した価値タグ。未設定のカテゴリは持たない */
  valueTags: Record<string, ValueTag>
  /** 固定費として扱うカテゴリ名 */
  fixedCategories: string[]
}

/**
 * カテゴリごとの実績と、見直し候補の理由を返す。
 * 金額の大きい順に並べる。
 */
export function analyzeExpenses(input: ExpenseIntelligenceInput): CategoryExpense[] {
  const fixedSet = new Set(input.fixedCategories)
  const categories = new Set([
    ...Object.keys(input.currentMonth),
    ...Object.keys(input.previousMonth),
    ...Object.keys(input.threeMonthTotal),
    ...Object.keys(input.budgets),
    ...Object.keys(input.valueTags),
  ])

  const rows: CategoryExpense[] = []

  for (const category of categories) {
    const current = yen(input.currentMonth[category] ?? 0)
    const previous = yen(input.previousMonth[category] ?? 0)
    const average = yen((input.threeMonthTotal[category] ?? 0) / 3)
    const isFixed = fixedSet.has(category)
    const budget = category in input.budgets ? yen(input.budgets[category]) : null
    const valueTag = input.valueTags[category] ?? null

    const reasons: ReviewReason[] = []
    if (budget !== null && current > budget) reasons.push('over_budget')
    if (getExpenseTrendState(current, previous, { isFixed }) === 'increased') {
      reasons.push('increased_from_previous_month')
    }
    if (getExpenseTrendState(current, average, { isFixed }) === 'increased') {
      reasons.push('above_three_month_average')
    }
    if (valueTag === 'review') reasons.push('tagged_for_review')

    rows.push({
      category,
      currentMonth: current,
      previousMonth: previous,
      threeMonthAverage: average,
      budget,
      budgetDifference: budget === null ? null : budget - current,
      previousMonthDifference: current - previous,
      averageDifference: current - average,
      annualized: current * 12,
      transactionCount: input.transactionCount[category] ?? 0,
      isFixed,
      valueTag,
      // 実績も予算も無いカテゴリは候補に挙げない
      candidateReason: current > 0 ? reasons : [],
      reviewCandidate: current > 0 && reasons.length > 0,
    })
  }

  return rows.sort((a, b) => b.currentMonth - a.currentMonth)
}

/** 見直し候補だけを、金額の大きい順で返す */
export function reviewCandidates(rows: CategoryExpense[]): CategoryExpense[] {
  return rows.filter(row => row.reviewCandidate)
}

export type TxRow = { id: string; date: string; amount: number; category: string; kind: string }
export type ItemRow = { transaction_id: string; amount: number; category: string }

/**
 * 取引と内訳からカテゴリ別の合計を作る。
 * 内訳がある取引は内訳側だけを数える（親を数えると二重計上）。
 */
export function tallyByCategory(
  transactions: TxRow[],
  items: ItemRow[]
): { totals: Record<string, number>; counts: Record<string, number> } {
  const itemsByTx = new Map<string, ItemRow[]>()
  for (const item of items) {
    const list = itemsByTx.get(item.transaction_id) ?? []
    list.push(item)
    itemsByTx.set(item.transaction_id, list)
  }

  const totals: Record<string, number> = {}
  const counts: Record<string, number> = {}
  const add = (category: string, amount: number) => {
    totals[category] = (totals[category] ?? 0) + amount
    counts[category] = (counts[category] ?? 0) + 1
  }

  for (const tx of transactions) {
    if (tx.kind === 'income') continue
    const split = itemsByTx.get(tx.id)
    if (split && split.length > 0) {
      for (const item of split) add(item.category, Number(item.amount) || 0)
    } else {
      add(tx.category, Number(tx.amount) || 0)
    }
  }

  return { totals, counts }
}
