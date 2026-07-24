import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { updateGoal, deleteGoal } from '@/lib/repositories/goals'
import { yen } from '@/lib/services/money'
import type { GoalInput, GoalKind, GoalStatus } from '@/types/goal'

type Context = { params: Promise<{ id: string }> }

const VALID_KINDS: GoalKind[] = ['fire', 'house', 'car', 'education', 'savings', 'travel', 'custom']
const VALID_STATUSES: GoalStatus[] = ['active', 'achieved', 'paused']

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()
  const { id } = await params

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const patch: Partial<GoalInput> = {}
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
  if (VALID_KINDS.includes(body.kind as GoalKind)) patch.kind = body.kind as GoalKind
  if (VALID_STATUSES.includes(body.status as GoalStatus)) patch.status = body.status as GoalStatus
  if (body.target_amount !== undefined) {
    patch.target_amount = body.target_amount === null ? null : yen(body.target_amount)
  }
  if (body.target_date !== undefined) {
    patch.target_date =
      typeof body.target_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.target_date)
        ? body.target_date
        : null
  }
  if (body.current_amount !== undefined) patch.current_amount = yen(body.current_amount)
  if (body.priority !== undefined) patch.priority = Number(body.priority) || 0
  if (body.monthly_contribution !== undefined) {
    patch.monthly_contribution =
      body.monthly_contribution === null ? null : yen(body.monthly_contribution)
  }

  try {
    return Response.json(await updateGoal(user.id, id, patch))
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()
  const { id } = await params

  try {
    await deleteGoal(user.id, id)
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
