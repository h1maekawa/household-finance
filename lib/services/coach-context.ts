// lib/services/coach-context.ts
//
// 決定的エンジン群を1本に束ねて「今日の洞察」を組み立てる純関数。
// DB I/O はここに入れない(引数で全部受け取る)ので、そのままテストできる。
// API 側 (app/api/coach/insights) がリポジトリでデータを集め、この関数に渡す。
import type { BudgetInput } from '@/types/budget'
import type { LifeGoal } from '@/types/goal'
import type { CoachAccount, CoachContext, CoachInsight, UpcomingDebit } from '@/types/coach'
import { computeBudget, computeCategoryProgress } from './budget-engine'
import { computeGoalProgress, pickPrimaryGoal } from './goal-progress'
import { buildCoachInsights } from './coach-rules'

export type CoachBuildInput = {
  today: string
  budgetInput: BudgetInput
  /** 予算のカテゴリ別サブ枠(category → amount) */
  categoryBudgets: Record<string, number>
  goals: LifeGoal[]
  /** 目標ID → 毎月の積立ペース(円/月)。省略した目標は monthly_contribution にフォールバック */
  goalPace?: Record<string, number>
  accounts: CoachAccount[]
  upcomingDebits: UpcomingDebit[]
  debitHorizonDays?: number
  /** ダッシュボードで主目標だけを扱いたい場合 true(コーチは全 active 目標を見る) */
  primaryGoalOnly?: boolean
}

export function buildCoachContext(input: CoachBuildInput): CoachContext {
  const budget = computeBudget(input.budgetInput)
  const categoryProgress = computeCategoryProgress(input.categoryBudgets, budget)

  const activeGoals = input.primaryGoalOnly
    ? [pickPrimaryGoal(input.goals)].filter((goal): goal is LifeGoal => goal !== null)
    : input.goals.filter(goal => goal.status === 'active')

  const goals = activeGoals.map(goal =>
    computeGoalProgress(goal, {
      asOf: input.today,
      monthlyPace: input.goalPace?.[goal.id],
    })
  )

  return {
    today: input.today,
    budget,
    categoryProgress,
    goals,
    accounts: input.accounts,
    upcomingDebits: input.upcomingDebits,
    debitHorizonDays: input.debitHorizonDays,
  }
}

export function generateCoachInsights(input: CoachBuildInput): CoachInsight[] {
  return buildCoachInsights(buildCoachContext(input))
}
