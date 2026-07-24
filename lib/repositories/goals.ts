// lib/repositories/goals.ts
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { yen } from '@/lib/services/money'
import type { GoalInput, LifeGoal } from '@/types/goal'

const COLUMNS =
  'id, kind, title, target_amount, target_date, current_amount, priority, monthly_contribution, status, assumptions'

function toGoal(row: Record<string, unknown>): LifeGoal {
  return {
    id: String(row.id),
    kind: (row.kind ?? 'savings') as LifeGoal['kind'],
    title: String(row.title ?? ''),
    target_amount: row.target_amount === null || row.target_amount === undefined ? null : yen(row.target_amount),
    target_date: (row.target_date as string | null) ?? null,
    current_amount: yen(row.current_amount),
    priority: Number(row.priority ?? 0),
    monthly_contribution:
      row.monthly_contribution === null || row.monthly_contribution === undefined
        ? null
        : yen(row.monthly_contribution),
    status: (row.status ?? 'active') as LifeGoal['status'],
    assumptions: (row.assumptions as Record<string, unknown> | null) ?? null,
  }
}

export async function listGoals(userId: string): Promise<LifeGoal[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('life_goals')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []).map(toGoal)
}

export async function createGoal(userId: string, input: GoalInput): Promise<LifeGoal> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('life_goals')
    .insert([{
      user_id: userId,
      kind: input.kind ?? 'savings',
      title: input.title,
      target_amount: input.target_amount ?? null,
      target_date: input.target_date ?? null,
      current_amount: yen(input.current_amount ?? 0),
      priority: input.priority ?? 0,
      monthly_contribution: input.monthly_contribution ?? null,
      status: input.status ?? 'active',
    }])
    .select(COLUMNS)
    .single()

  if (error) throw new Error(error.message)
  return toGoal(data)
}

export async function updateGoal(
  userId: string,
  goalId: string,
  patch: Partial<GoalInput>
): Promise<LifeGoal> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('life_goals')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', goalId)
    .select(COLUMNS)
    .single()

  if (error) throw new Error(error.message)
  return toGoal(data)
}

export async function deleteGoal(userId: string, goalId: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('life_goals')
    .delete()
    .eq('user_id', userId)
    .eq('id', goalId)

  if (error) throw new Error(error.message)
}
