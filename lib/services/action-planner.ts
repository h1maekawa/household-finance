// lib/services/action-planner.ts
//
// 「今月やること」の組み立て（スペック §35 / §36）。純関数。
//
// **ここは判定エンジンではない。** 超過・引落不足・払い漏れの判定は既存
// coach-rules.ts が持ち、金額は budget-engine / asset-planning が出す。
// ここがやるのは
//
//   既に出ている判定と金額を「行動」の形に言い換え、優先順に並べ、絞る
//
// だけ。新しい金融ルールをここへ足さないこと。
//
// 以前はこの選別が Home の JSX の中で条件分岐として書かれていた。UI に
// 「何を見せるべきか」の判断が乗っていたので、ここへ移した。
import type { CoachInsight } from '@/types/coach'
import type { CategoryProgress } from '@/types/budget'
import type { AssetPlanningResult } from './asset-planning'
import { formatYenPlain, yen } from './money'

/** 行動の種類（スペック §35 の Action候補） */
export const ACTION_KINDS = [
  'payment',
  'expense',
  'emergency_fund',
  'savings',
  'investment',
  'side_income',
  'uncategorized',
  'settings',
] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

export type ActionSeverity = 'action' | 'warning' | 'info'

export type MonthlyAction = {
  /** 重複排除と表示キー。日付を含めない（同じ月の中で安定させる） */
  id: string
  kind: ActionKind
  /** 命令形の見出し。「外食をあと5,000円以内に」 */
  title: string
  detail: string | null
  /** 伴う金額。金額の無い行動は null */
  amount: number | null
  severity: ActionSeverity
  /** 大きいほど先に出す */
  priority: number
  href: string
}

/** 「今月やること」の上限（スペック §35: 最大3〜5件） */
export const MAX_MONTHLY_ACTIONS = 5

/** Home に出す件数（スペック §7 Home 5: 最大3件） */
export const HOME_ACTION_LIMIT = 3

export type ActionPlannerInput = {
  month: string
  /** 既存の資産形成プラン。配分・防衛資金・設定不足はここが正 */
  plan: AssetPlanningResult
  /** 既存 coach-rules が出した判定。ここで判定し直さない */
  insights: CoachInsight[]
  /** カテゴリ別の進捗。残額は budget-engine が出した値 */
  categoryProgress: CategoryProgress[]
  /** カテゴリが未確定の取引件数 */
  uncategorizedCount: number
  /** どのカード設定にも紐づかなかったカード利用 */
  unassignedCardUsage: { count: number; total: number } | null
  /** 残高がマイナスになる最初の日。無ければ null */
  firstNegativeDay: { date: string; balance: number } | null
}

function formatDay(date: string): string {
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日`
}

// ---------------------------------------------------------------- 支払い

/**
 * 支払不足。
 * 残高予測と、coach-rules が出した引落関連の判定をまとめる。
 * どちらも既に判定済みなので、ここでは行動の言い方へ写すだけ。
 */
function paymentActions(input: ActionPlannerInput): MonthlyAction[] {
  const actions: MonthlyAction[] = []

  if (input.firstNegativeDay) {
    const shortfall = Math.abs(yen(input.firstNegativeDay.balance))
    actions.push({
      id: `payment:negative:${input.firstNegativeDay.date}`,
      kind: 'payment',
      title: `${formatDay(input.firstNegativeDay.date)}までに ${formatYenPlain(shortfall)} 用意する`,
      detail: '今の予定のままだと、この日に残高が足りなくなります',
      amount: shortfall,
      severity: 'action',
      priority: 110,
      href: '/plan?tab=payments',
    })
  }

  // 口座単位の不足・資金移動の提案は coach-rules が既に出している
  for (const insight of input.insights) {
    if (insight.severity !== 'action') continue
    if (insight.payload.action === 'propose_transfer') {
      actions.push({
        id: `payment:transfer:${insight.payload.to_account_id}`,
        kind: 'payment',
        title: `${insight.payload.from_account_name}から${insight.payload.to_account_name}へ ${formatYenPlain(insight.payload.amount)} 移す`,
        detail: `${formatDay(insight.payload.by)}の引き落としに足りません`,
        amount: insight.payload.amount,
        severity: 'action',
        priority: 105,
        href: '/investments?tab=accounts',
      })
    } else if (insight.payload.action === 'keep_balance') {
      actions.push({
        id: `payment:keep:${insight.payload.account_id}`,
        kind: 'payment',
        title: `${insight.payload.account_name}に ${formatYenPlain(insight.payload.amount)} 残しておく`,
        detail: `${formatDay(insight.payload.by)}の引き落とし分です`,
        amount: insight.payload.amount,
        severity: 'action',
        priority: 100,
        href: '/plan?tab=payments',
      })
    } else if (insight.type === 'cash_shortfall') {
      actions.push({
        id: 'payment:shortfall',
        kind: 'payment',
        title: '引き落としに足りない分を用意する',
        detail: insight.body,
        amount: null,
        severity: 'action',
        priority: 108,
        href: '/plan?tab=payments',
      })
    }
  }

  return actions
}

// ---------------------------------------------------------------- 支出

/**
 * 支出（スペック §36 ①「外食費を残り¥5,000以内にする」）。
 *
 * どのカテゴリが問題かの判定は coach-rules、残額は budget-engine の
 * CategoryProgress.remaining。ここで予算と実績を引き算しない。
 */
function expenseActions(input: ActionPlannerInput): MonthlyAction[] {
  const remainingByCategory = new Map(
    input.categoryProgress.map(progress => [progress.category, progress.remaining])
  )
  const actions: MonthlyAction[] = []

  for (const insight of input.insights) {
    if (insight.payload.action !== 'reduce_category') continue
    const { category } = insight.payload
    const remaining = remainingByCategory.get(category)

    // 既に超過しているなら「あと◯円以内」とは言えない。戻す量で言う
    const over = insight.type === 'category_over' ? insight.payload.amount : 0
    actions.push({
      id: `expense:${category}`,
      kind: 'expense',
      title:
        over > 0
          ? `${category}を ${formatYenPlain(over)} 戻す`
          : `${category}を残り ${formatYenPlain(Math.max(remaining ?? 0, 0))} 以内に`,
      detail: insight.body,
      amount: over > 0 ? over : (remaining ?? null),
      severity: insight.severity === 'action' ? 'action' : 'warning',
      priority: over > 0 ? 85 : 70,
      href: '/transactions?tab=analysis',
    })
  }

  // 変動費全体の超過・ペース超過
  for (const insight of input.insights) {
    if (insight.payload.action !== 'review_budget') continue
    actions.push({
      id: `expense:budget:${insight.type}`,
      kind: 'expense',
      title:
        insight.type === 'over_budget'
          ? `今月の変動費が ${formatYenPlain(Math.abs(insight.payload.amount))} 超過。使い方を見直す`
          : `残りの日は1日 ${formatYenPlain(insight.payload.amount)} までに抑える`,
      detail: insight.body,
      amount: Math.abs(insight.payload.amount),
      severity: insight.type === 'over_budget' ? 'action' : 'warning',
      priority: insight.type === 'over_budget' ? 90 : 72,
      href: '/plan',
    })
  }

  return actions
}

// ---------------------------------------------------------------- 配分

/** 防衛資金・貯金・資産形成（スペック §36 ②③）。金額は asset-planning が正 */
function allocationActions(input: ActionPlannerInput): MonthlyAction[] {
  const actions: MonthlyAction[] = []
  const { emergencyFund, allocation } = input.plan

  if (emergencyFund.status === 'underfunded' && (emergencyFund.reserveGap ?? 0) > 0) {
    actions.push({
      id: 'emergency_fund',
      kind: 'emergency_fund',
      title: `防衛資金へ あと ${formatYenPlain(emergencyFund.reserveGap!)} 積む`,
      detail:
        emergencyFund.currentReserve !== null && emergencyFund.requiredReserve !== null
          ? `現在 ${formatYenPlain(emergencyFund.currentReserve)} / 目安 ${formatYenPlain(emergencyFund.requiredReserve)}（生活費を安全側に見た目安）`
          : null,
      amount: emergencyFund.reserveGap,
      severity: 'warning',
      priority: 80,
      href: '/plan',
    })
  }

  if ((allocation.savings ?? 0) > 0) {
    actions.push({
      id: 'savings',
      kind: 'savings',
      title: `${formatYenPlain(allocation.savings!)} を貯金へ`,
      detail: '今月の配分です',
      amount: allocation.savings,
      severity: 'info',
      priority: 60,
      href: '/plan',
    })
  }

  if ((allocation.assetBuilding ?? 0) > 0) {
    actions.push({
      id: 'investment',
      kind: 'investment',
      title: `${formatYenPlain(allocation.assetBuilding!)} を資産形成へ`,
      detail: '今月の配分です',
      amount: allocation.assetBuilding,
      severity: 'info',
      priority: 55,
      href: '/plan',
    })
  }

  return actions
}

// ---------------------------------------------------------------- 収入

/**
 * 副業・収入（スペック §35）。
 *
 * **いくら稼ぐべきかをここで決めない。** 目標に対する不足額は goal-progress が
 * 出したものを使い、行動としては「条件を変えて比べる」へ繋ぐ（Scenario Engine）。
 */
function incomeActions(input: ActionPlannerInput): MonthlyAction[] {
  const actions: MonthlyAction[] = []

  for (const insight of input.insights) {
    if (insight.payload.action !== 'review_goal') continue
    const gap = insight.payload.required_monthly - insight.payload.monthly_pace
    if (gap <= 0) continue
    actions.push({
      id: `side_income:${insight.payload.goal_id}`,
      kind: 'side_income',
      title: `毎月 ${formatYenPlain(gap)} を埋める条件を比べる`,
      detail: insight.body,
      amount: gap,
      severity: 'warning',
      priority: 65,
      href: '/plan?tab=future',
    })
  }

  return actions
}

// ---------------------------------------------------------------- 確認・設定

/** 未分類取引と設定不足。金額を伴わない行動 */
function reviewActions(input: ActionPlannerInput): MonthlyAction[] {
  const actions: MonthlyAction[] = []

  if (input.uncategorizedCount > 0) {
    actions.push({
      id: 'uncategorized',
      kind: 'uncategorized',
      title: `未分類の取引を ${input.uncategorizedCount}件 確認する`,
      detail: 'カテゴリが決まると、支出の分析に反映されます',
      amount: null,
      severity: 'info',
      priority: 50,
      href: '/transactions?tab=review',
    })
  }

  if (input.unassignedCardUsage && input.unassignedCardUsage.count > 0) {
    actions.push({
      id: 'settings:unassigned_card',
      kind: 'settings',
      title: `カード請求に未割当の利用 ${input.unassignedCardUsage.count}件 を確認する`,
      detail: `${formatYenPlain(input.unassignedCardUsage.total)} が請求見込みから抜けています`,
      amount: input.unassignedCardUsage.total,
      severity: 'warning',
      priority: 68,
      href: '/plan?tab=payments',
    })
  }

  // 欠損の文言は各エンジンが出したものをそのまま使う
  for (const missing of input.plan.missingData) {
    actions.push({
      id: `settings:${missing}`,
      kind: 'settings',
      title: missing,
      detail: '設定すると計算できるようになります',
      amount: null,
      severity: 'info',
      priority: 40,
      href: '/settings',
    })
  }

  return actions
}

// ---------------------------------------------------------------- 公開API

const SEVERITY_RANK: Record<ActionSeverity, number> = { action: 3, warning: 2, info: 1 }

export function sortActions(actions: MonthlyAction[]): MonthlyAction[] {
  return [...actions].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (severityDiff !== 0) return severityDiff
    if (b.priority !== a.priority) return b.priority - a.priority
    return a.id < b.id ? -1 : 1
  })
}

/**
 * 今月やること。重い順に最大 MAX_MONTHLY_ACTIONS 件。
 *
 * 全部並べない。並べると「何から手を付ければいいか」が分からなくなり、
 * 結局どれもやらない画面になる（スペック §35）。
 */
export function buildMonthlyActions(input: ActionPlannerInput): MonthlyAction[] {
  const all = [
    ...paymentActions(input),
    ...expenseActions(input),
    ...allocationActions(input),
    ...incomeActions(input),
    ...reviewActions(input),
  ]

  const unique = new Map<string, MonthlyAction>()
  for (const action of all) {
    if (!unique.has(action.id)) unique.set(action.id, action)
  }

  return sortActions([...unique.values()]).slice(0, MAX_MONTHLY_ACTIONS)
}
