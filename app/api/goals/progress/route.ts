import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { listGoals } from '@/lib/repositories/goals'
import { computeGoalProgress } from '@/lib/services/goal-progress'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * GET /api/goals/progress
 * 目標の達成率・達成予測日を返す(決定的計算)。ペースは monthly_contribution を用いる。
 * 実績ベースのペース(積立履歴)を厳密化するのは COULD(スペック §2.6)。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  try {
    const goals = await listGoals(user.id)
    const asOf = today()
    const progress = goals
      .filter(goal => goal.status !== 'paused')
      .map(goal => computeGoalProgress(goal, { asOf }))
    return Response.json({ asOf, goals: progress })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
