import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { loadCoachInputs } from '@/lib/services/budget-loader'
import { generateCoachInsights } from '@/lib/services/coach-context'
import { listInsights, saveInsights, updateInsightStatus } from '@/lib/repositories/insights'

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * GET /api/coach/insights
 * その日の未読洞察を返す。まだ生成されていなければ、ルールベースでその場生成して保存する。
 * (MVP はアプリ内バッジ。夜間バッチ化するときはこの生成部分を Cron から呼ぶ。)
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const day = today()
  try {
    const existing = await listInsights(user.id, {
      generatedFor: day,
      statuses: ['new', 'seen'],
    })
    if (existing.length > 0) {
      return Response.json({ generated_for: day, insights: existing })
    }

    const inputs = await loadCoachInputs(user.id, currentMonth(), day)
    const insights = generateCoachInsights({
      today: day,
      budgetInput: inputs.budget.input,
      categoryBudgets: inputs.budget.categoryBudgetMap,
      goals: inputs.goals,
      accounts: inputs.accounts,
      upcomingDebits: inputs.upcomingDebits,
    })

    const saved = await saveInsights(user.id, insights)
    return Response.json({ generated_for: day, insights: saved })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

/** POST { insight_id, status } — 既読/対応済み/却下に更新する */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const id = typeof body.insight_id === 'string' ? body.insight_id : ''
  const status = body.status
  if (!id || !['seen', 'dismissed', 'done'].includes(status as string)) {
    return Response.json({ error: 'insight_id と status が必要です' }, { status: 400 })
  }

  try {
    const updated = await updateInsightStatus(user.id, id, status as 'seen' | 'dismissed' | 'done')
    return Response.json(updated)
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
