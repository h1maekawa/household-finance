// lib/services/scenario-loader.ts
//
// Scenario 比較の収集(I/O)。
//
// **新しい金融式をここに書かない。** 現在資産・毎月の積立額は既存
// asset-planning の値、目標は既存 life_goals、FIRE の必要資産は
// fire-planner の値をそのまま使い、計算は scenario-engine の純関数に渡す。
//
// Scenario の結果は保存しない（スペック §25）。入力条件から毎回計算する。
import type { SupabaseClient } from '@supabase/supabase-js'
import { getGoal, listGoals } from '@/lib/repositories/goals'
import { loadAssetPlanning } from './asset-planning-loader'
import { composeFirePlan, loadFireSettings } from './fire-planner-loader'
import { loadExpenseIntelligence } from './expense-intelligence-loader'
import {
  buildScenarioComparisonSet,
  expenseReductionAmount,
  type ScenarioComparisonSet,
} from './scenario-engine'
import { nonNegativeYen } from './money'

export const SCENARIO_TARGET_KINDS = ['goal', 'fire'] as const
export type ScenarioTargetKind = (typeof SCENARIO_TARGET_KINDS)[number]

export function isScenarioTargetKind(value: unknown): value is ScenarioTargetKind {
  return typeof value === 'string' && (SCENARIO_TARGET_KINDS as readonly string[]).includes(value)
}

/** 画面が選べる目標。新しい目標データを Scenario 側へ複製しない（スペック §22） */
export type ScenarioTargetOption = {
  kind: ScenarioTargetKind
  /** goal のときは life_goals.id、fire のときは 'fire' */
  id: string
  label: string
  /** 目標額。算出できないなら null */
  targetAssets: number | null
}

export type ScenarioRequest = {
  targetKind: ScenarioTargetKind
  /** targetKind が 'goal' のときの life_goals.id。未指定なら主目標を使う */
  goalId?: string | null
  additionalMonthlySavings: number
  additionalMonthlyInvestment: number
  /** 金額を直接指定する場合 */
  monthlyExpenseReduction: number
  /** カテゴリと削減率で指定する場合（スペック §14）。金額はサーバーで出す */
  expenseReduction?: { category: string; ratio: number } | null
  monthlyExtraContribution: number
  annualReturnRate: number
}

export type ScenarioLoad = {
  comparison: ScenarioComparisonSet
  /** 選択中の目標 */
  target: ScenarioTargetOption
  /** 選べる目標の一覧 */
  targetOptions: ScenarioTargetOption[]
  /** 支出削減をカテゴリ指定した場合の内訳 */
  expenseReduction: {
    category: string
    ratio: number
    /** そのカテゴリの当月支出。分からないなら null */
    currentMonthly: number | null
    /** 削減できる額。分からないなら null */
    amount: number | null
  } | null
  missingData: string[]
}

export async function loadScenarioComparison(
  userId: string,
  request: ScenarioRequest,
  month: string,
  today: string,
  client: SupabaseClient
): Promise<ScenarioLoad> {
  const [assetPlanning, goals, fireSettings] = await Promise.all([
    loadAssetPlanning(userId, month, today, client),
    listGoals(userId, client),
    loadFireSettings(userId, client),
  ])

  // FIRE の必要資産は fire-planner が出した値をそのまま使う。
  // 税計算を Scenario 側へ複製しない（スペック §31）
  const firePlan = composeFirePlan(fireSettings, assetPlanning, month)

  const targetOptions: ScenarioTargetOption[] = [
    ...goals
      .filter(goal => goal.status !== 'paused' && goal.target_amount !== null)
      .map(goal => ({
        kind: 'goal' as const,
        id: goal.id,
        label: goal.title,
        targetAssets: goal.target_amount,
      })),
    {
      kind: 'fire' as const,
      id: 'fire',
      label: `${firePlan.fireTypeLabel}に必要な資産`,
      targetAssets: firePlan.primary.requiredAssets,
    },
  ]

  const target = await resolveTarget(userId, request, targetOptions, client)

  const missingData: string[] = []
  if (assetPlanning.assets.totalAssets === null) {
    missingData.push('総資産が分からないため、到達時期を計算できません')
  }
  if (assetPlanning.plan.monthlyAssetContribution === null) {
    missingData.push('現在の毎月の積立額が分からないため、到達時期を計算できません')
  }
  if (target.targetAssets === null) {
    missingData.push(
      target.kind === 'fire'
        ? 'FIRE の必要資産が算出できないため、到達時期を計算できません'
        : '目標額が未設定のため、到達時期を計算できません'
    )
  }

  const reduction = await resolveExpenseReduction(userId, request, month, client)
  if (reduction && reduction.amount === null) {
    missingData.push(`${reduction.category} の当月支出が分からないため、削減額を計算できません`)
  }

  return {
    target,
    targetOptions,
    expenseReduction: reduction,
    missingData,
    comparison: buildScenarioComparisonSet({
      currentAssets: assetPlanning.assets.totalAssets,
      targetAssets: target.targetAssets,
      startMonth: month,
      // Baseline は既存の通常貯金 + 資産形成をそのまま使う（スペック §7）
      baseMonthlyContribution: assetPlanning.plan.monthlyAssetContribution,
      adjustments: {
        additionalMonthlySavings: nonNegativeYen(request.additionalMonthlySavings),
        additionalMonthlyInvestment: nonNegativeYen(request.additionalMonthlyInvestment),
        // カテゴリ指定があればそちらを使う。両方来たら金額指定は無視する
        monthlyExpenseReduction:
          reduction?.amount ?? nonNegativeYen(request.monthlyExpenseReduction),
        // 副業収入を全額投資すると決めない。指定された額だけ入れる（スペック §16）
        monthlyExtraContribution: nonNegativeYen(request.monthlyExtraContribution),
      },
      selectedReturnRate: Math.max(Number(request.annualReturnRate) || 0, 0),
    }),
  }
}

async function resolveTarget(
  userId: string,
  request: ScenarioRequest,
  options: ScenarioTargetOption[],
  client: SupabaseClient
): Promise<ScenarioTargetOption> {
  const fireOption = options.find(option => option.kind === 'fire')!
  if (request.targetKind === 'fire') return fireOption

  if (request.goalId) {
    const known = options.find(option => option.kind === 'goal' && option.id === request.goalId)
    if (known) return known
    // 一覧に無い(目標額が未設定など)場合も、選んだ目標として扱う
    const goal = await getGoal(userId, request.goalId, client)
    if (goal) {
      return { kind: 'goal', id: goal.id, label: goal.title, targetAssets: goal.target_amount }
    }
  }

  // 目標の並びは listGoals が priority 順に返す。ここで選び直さない
  return options.find(option => option.kind === 'goal') ?? fireOption
}

async function resolveExpenseReduction(
  userId: string,
  request: ScenarioRequest,
  month: string,
  client: SupabaseClient
): Promise<ScenarioLoad['expenseReduction']> {
  const category = request.expenseReduction?.category?.trim()
  if (!category) return null

  const ratio = Math.min(Math.max(Number(request.expenseReduction?.ratio) || 0, 0), 1)

  // カテゴリの当月支出は Expense Intelligence が正。ここで集計し直さない
  const intelligence = await loadExpenseIntelligence(userId, month, client)
  const row = intelligence.categories.find(item => item.category === category)
  if (!row) return { category, ratio, currentMonthly: null, amount: null }

  return {
    category,
    ratio,
    currentMonthly: row.currentMonth,
    amount: expenseReductionAmount(row.currentMonth, ratio),
  }
}
