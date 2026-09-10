// lib/services/ai-fp-context.ts
//
// AI FP へ渡す「計算済みデータ」の組み立て（スペック §33）。純関数。
//
// AI は金額を作らない。ここで作った文字列に無い数字は、AI の答えにも
// 出てはいけない。生の取引は渡さない。
import type { CategoryExpense } from './expense-intelligence'
import { REVIEW_REASON_LABEL, VALUE_TAG_LABEL } from './expense-intelligence'
import type { MonthlyAction } from './action-planner'
import { formatMonthsDuration, type ScenarioComparison } from './scenario-engine'
import type { FinancialIntent } from './ai-fp-intent'

const yen = (n: number | null | undefined) =>
  n === null || n === undefined ? '未計算' : `${Math.round(n).toLocaleString('ja-JP')}円`

const duration = (months: number | null): string =>
  months === null ? '到達しません' : formatMonthsDuration(months)

export type AiFpExtras = {
  intent: FinancialIntent
  /** 条件を変えた比較（Scenario Engine の結果） */
  scenario?: {
    label: string
    comparison: ScenarioComparison
    targetAssets: number | null
  } | null
  actions?: MonthlyAction[] | null
  reviewCandidates?: CategoryExpense[] | null
}

function scenarioSection(extras: AiFpExtras): string[] {
  if (!extras.scenario) return []
  const { label, comparison, targetAssets } = extras.scenario
  const { baseline, adjusted, monthsSaved } = comparison

  const lines = [
    '',
    `条件を変えた場合の比較（${label}）`,
    `- 目標額: ${yen(targetAssets)}`,
    `- 想定利回り: ${(comparison.annualReturnRate * 100).toFixed(1)}%（仮定であって保証ではない）`,
    `- 現在のペース: 毎月 ${yen(baseline.monthlyContribution)} → 到達まで ${duration(baseline.monthsToTarget)}${baseline.projectedTargetMonth ? `（${baseline.projectedTargetMonth}ごろ）` : ''}`,
    `- 変更後: 毎月 ${yen(adjusted.monthlyContribution)} → 到達まで ${duration(adjusted.monthsToTarget)}${adjusted.projectedTargetMonth ? `（${adjusted.projectedTargetMonth}ごろ）` : ''}`,
  ]

  if (monthsSaved === null) {
    lines.push('- 短縮期間: 片方が到達しないため、数字では言えない')
  } else if (monthsSaved <= 0) {
    lines.push('- 短縮期間: 変わらない')
  } else {
    lines.push(`- 短縮期間: ${duration(monthsSaved)}早くなる`)
  }

  return lines
}

function actionsSection(extras: AiFpExtras): string[] {
  if (!extras.actions || extras.actions.length === 0) return []
  const lines = ['', '今月やること（重い順。この並びを変えない）']
  for (const [index, action] of extras.actions.entries()) {
    lines.push(`${index + 1}. ${action.title}${action.detail ? `（${action.detail}）` : ''}`)
  }
  return lines
}

function reviewSection(extras: AiFpExtras): string[] {
  if (!extras.reviewCandidates || extras.reviewCandidates.length === 0) return []
  const lines = ['', '見直し候補（「削るべき」ではない。判断はユーザーがする）']
  for (const row of extras.reviewCandidates) {
    const reasons = row.candidateReason.map(reason => REVIEW_REASON_LABEL[reason]).join('・')
    const tag = row.valueTag ? `${VALUE_TAG_LABEL[row.valueTag]}` : '価値タグ未設定'
    lines.push(
      `- ${row.category}: 今月 ${yen(row.currentMonth)} / 先月 ${yen(row.previousMonth)} / 3ヶ月平均 ${yen(row.threeMonthAverage)}（${reasons}。${tag}）`
    )
  }
  return lines
}

/**
 * 既存の説明用コンテキストへ、質問に必要な計算結果だけを足す。
 * 何も該当しなければ足さない（渡す情報を増やすほど AI が迷う）。
 */
export function appendAiFpContext(baseContext: string, extras: AiFpExtras): string {
  return [
    baseContext,
    ...scenarioSection(extras),
    ...actionsSection(extras),
    ...reviewSection(extras),
  ].join('\n')
}
