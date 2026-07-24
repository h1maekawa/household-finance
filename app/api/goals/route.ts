import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { listGoals, createGoal } from '@/lib/repositories/goals'
import { yen } from '@/lib/services/money'
import type { GoalInput, GoalKind } from '@/types/goal'

const VALID_KINDS: GoalKind[] = ['fire', 'house', 'car', 'education', 'savings', 'travel', 'custom']

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()
  try {
    return Response.json(await listGoals(user.id))
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

function parseGoalBody(body: Record<string, unknown>): GoalInput | null {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return null

  const targetAmount =
    body.target_amount === null || body.target_amount === undefined
      ? null
      : yen(body.target_amount)
  const targetDate =
    typeof body.target_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.target_date)
      ? body.target_date
      : null

  return {
    kind: VALID_KINDS.includes(body.kind as GoalKind) ? (body.kind as GoalKind) : 'savings',
    title,
    target_amount: targetAmount,
    target_date: targetDate,
    current_amount: yen(body.current_amount ?? 0),
    priority: Number(body.priority) || 0,
    monthly_contribution:
      body.monthly_contribution === null || body.monthly_contribution === undefined
        ? null
        : yen(body.monthly_contribution),
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const input = parseGoalBody(body)
  if (!input) return Response.json({ error: '目標のタイトルを入力してください' }, { status: 400 })

  try {
    return Response.json(await createGoal(user.id, input), { status: 201 })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
