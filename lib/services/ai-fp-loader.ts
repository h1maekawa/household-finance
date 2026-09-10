// lib/services/ai-fp-loader.ts
//
// AI FP の収集(I/O)（スペック §33）。
//
//   質問 → 意図の判定(決定論) → 既存エンジンで計算 → AIが説明
//
// **新しい金融式をここに書かない。** 必要な計算は既存の純関数
// （scenario-engine / action-planner / expense-intelligence）に任せ、
// ここは「どれを呼ぶか」を決めて結果を束ねるだけ。
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMergedCategories } from '@/lib/categories'
import { listGoals } from '@/lib/repositories/goals'
import { loadAssetPlanning } from './asset-planning-loader'
import { loadExpenseIntelligence } from './expense-intelligence-loader'
import { loadMonthlyActions } from './action-planner-loader'
import { buildCoachExplainContext } from './coach-explain-context'
import { pickPrimaryGoal } from './goal-progress'
import { reviewCandidates } from './expense-intelligence'
import {
  buildScenarioComparisonSet,
  expenseReductionAmount,
  type ScenarioComparison,
} from './scenario-engine'
import { DEFAULT_SCENARIO_RETURN_RATE } from './return-assumptions'
import { appendAiFpContext, type AiFpExtras } from './ai-fp-context'
import { parseFinancialQuestion, type FinancialIntent } from './ai-fp-intent'

export type AiFpAnswerSource = {
  intent: FinancialIntent
  /** AI へ渡す計算済みデータ。ここに無い数字は答えに出てはいけない */
  context: string
  /** 画面に決定論の数字として出す比較。無ければ null */
  scenario: {
    label: string
    targetAssets: number | null
    comparison: ScenarioComparison
  } | null
}

const NO_ADJUSTMENT = {
  additionalMonthlySavings: 0,
  additionalMonthlyInvestment: 0,
  monthlyExpenseReduction: 0,
  monthlyExtraContribution: 0,
}

export async function loadAiFpAnswerSource(
  userId: string,
  question: string,
  month: string,
  today: string,
  client: SupabaseClient
): Promise<AiFpAnswerSource> {
  const [assetPlanning, categories, goals] = await Promise.all([
    loadAssetPlanning(userId, month, today, client),
    getMergedCategories(userId, client),
    listGoals(userId, client),
  ])

  // カテゴリ名はユーザー自身の一覧とだけ突き合わせる。
  // 「タバコ」等をシステム側で決め打ちしない
  const intent = parseFinancialQuestion(
    question,
    categories.expense.map(category => category.name)
  )

  const baseContext = buildCoachExplainContext(assetPlanning.plan, assetPlanning.assets)
  const extras: AiFpExtras = { intent }

  if (intent.kind === 'actions') {
    const { actions } = await loadMonthlyActions(userId, month, today, client)
    extras.actions = actions
  }

  if (intent.kind === 'review') {
    const intelligence = await loadExpenseIntelligence(userId, month, client)
    extras.reviewCandidates = reviewCandidates(intelligence.categories)
  }

  const scenario = await buildScenario(userId, intent, month, client, {
    currentAssets: assetPlanning.assets.totalAssets,
    baseMonthlyContribution: assetPlanning.plan.monthlyAssetContribution,
    primaryGoal: pickPrimaryGoal(goals),
  })
  if (scenario) extras.scenario = scenario

  return { intent, scenario, context: appendAiFpContext(baseContext, extras) }
}

async function buildScenario(
  userId: string,
  intent: FinancialIntent,
  month: string,
  client: SupabaseClient,
  base: {
    currentAssets: number | null
    baseMonthlyContribution: number | null
    primaryGoal: ReturnType<typeof pickPrimaryGoal>
  }
): Promise<AiFpAnswerSource['scenario']> {
  let adjustments = { ...NO_ADJUSTMENT }
  let label: string
  let targetAssets: number | null

  switch (intent.kind) {
    case 'goal_eta':
      // 質問文で指定された目標額。AIが決めた額ではない
      targetAssets = intent.targetAssets
      label = `${intent.targetAssets.toLocaleString('ja-JP')}円までの到達`
      break

    case 'scenario_contribution':
      targetAssets = base.primaryGoal?.target_amount ?? null
      adjustments =
        intent.field === 'investment'
          ? { ...NO_ADJUSTMENT, additionalMonthlyInvestment: intent.monthlyAmount }
          : { ...NO_ADJUSTMENT, additionalMonthlySavings: intent.monthlyAmount }
      label =
        intent.field === 'investment'
          ? `毎月の投資を ${intent.monthlyAmount.toLocaleString('ja-JP')}円 増やす`
          : `毎月の貯金を ${intent.monthlyAmount.toLocaleString('ja-JP')}円 増やす`
      break

    case 'scenario_extra_income':
      targetAssets = base.primaryGoal?.target_amount ?? null
      adjustments = { ...NO_ADJUSTMENT, monthlyExtraContribution: intent.monthlyAmount }
      // 「全額を資産形成へ回す」条件であることを明示する（スペック §16）
      label = `副業・追加収入 ${intent.monthlyAmount.toLocaleString('ja-JP')}円/月 を全額そのまま資産形成へ回す`
      break

    case 'scenario_expense_cut': {
      // 削減額は Expense Intelligence の当月支出から出す。AIが決めない
      const intelligence = await loadExpenseIntelligence(userId, month, client)
      const row = intelligence.categories.find(item => item.category === intent.category)
      if (!row || row.currentMonth <= 0) return null

      const amount = expenseReductionAmount(row.currentMonth, intent.ratio)
      targetAssets = base.primaryGoal?.target_amount ?? null
      adjustments = { ...NO_ADJUSTMENT, monthlyExpenseReduction: amount }
      label = `${intent.category}を${Math.round(intent.ratio * 100)}%減らして ${amount.toLocaleString('ja-JP')}円/月 を資産形成へ回す`
      break
    }

    default:
      return null
  }

  const set = buildScenarioComparisonSet({
    currentAssets: base.currentAssets,
    targetAssets,
    startMonth: month,
    baseMonthlyContribution: base.baseMonthlyContribution,
    adjustments,
    selectedReturnRate: DEFAULT_SCENARIO_RETURN_RATE,
  })

  return { label, targetAssets, comparison: set.selected }
}
