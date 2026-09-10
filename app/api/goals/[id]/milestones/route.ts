import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getGoal } from '@/lib/repositories/goals'
import { buildMilestoneTrack, suggestMilestoneAmounts } from '@/lib/services/goal-milestone'
import { readFailed, writeFailed } from '@/lib/api-errors'
import { currentMonthJst } from '@/lib/jst'
import type { GoalMilestone } from '@/types/goal'

export const dynamic = 'force-dynamic'

/**
 * GET /api/goals/[id]/milestones
 *
 * 通過点と、その進捗（判定は goal-milestone.ts の純関数）。
 * suggested は **候補** で、保存はしていない。画面が勝手に保存しないこと。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const { id } = await params

  try {
    const goal = await getGoal(user.id, id, supabase)
    if (!goal) return Response.json({ error: '目標が見つかりません' }, { status: 404 })

    const { data, error } = await supabase
      .from('goal_milestones')
      .select('id, goal_id, amount, label, position')
      .eq('goal_id', id)
      .order('position', { ascending: true })

    if (error) return readFailed('api/goals/[id]/milestones', error)

    const milestones = (data ?? []) as GoalMilestone[]
    return Response.json({
      milestones,
      suggested: suggestMilestoneAmounts(goal.target_amount, goal.current_amount),
      track: buildMilestoneTrack({
        currentAmount: goal.current_amount,
        milestones,
        monthlyPace: goal.monthly_contribution ?? 0,
        asOfMonth: currentMonthJst(),
      }),
    })
  } catch (error) {
    return readFailed('api/goals/[id]/milestones', error)
  }
}

/**
 * PUT /api/goals/[id]/milestones — 通過点を全置換する。
 *
 * 目標の所有者確認・金額の重複排除・並び順はDB側
 * （replace_goal_milestones）が保証する。ここでは形だけ整えて渡す。
 * 空配列を渡すと通過点を解除する。
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const { id } = await params

  const body = (await request.json().catch(() => ({}))) as { milestones?: unknown }
  if (!Array.isArray(body.milestones)) {
    return Response.json({ error: 'milestones は配列で指定してください' }, { status: 400 })
  }

  const milestones = body.milestones.map(raw => {
    const item = (raw ?? {}) as Record<string, unknown>
    const label = String(item.label ?? '').trim().slice(0, 60)
    return { amount: Math.round(Number(item.amount) || 0), label: label || null }
  })

  if (milestones.some(m => m.amount <= 0)) {
    return Response.json({ error: '通過点の金額は1円以上で入力してください' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('replace_goal_milestones', {
    p_goal_id: id,
    p_milestones: milestones,
  })

  if (error) {
    const message = error.message.includes('goal not found')
      ? '目標が見つかりません'
      : error.message.includes('12 or fewer')
        ? '通過点は12件までです'
        : null
    if (message) return Response.json({ error: message }, { status: 400 })
    return writeFailed('api/goals/[id]/milestones', error)
  }

  return Response.json(data)
}
