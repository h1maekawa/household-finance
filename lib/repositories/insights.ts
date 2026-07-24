// lib/repositories/insights.ts
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { CoachInsight, CoachInsightRow, InsightAction } from '@/types/coach'

const COLUMNS = 'id, type, severity, title, body, payload, status, generated_for, created_at'

function toRow(row: Record<string, unknown>): CoachInsightRow {
  return {
    id: String(row.id),
    type: row.type as CoachInsightRow['type'],
    severity: row.severity as CoachInsightRow['severity'],
    title: String(row.title ?? ''),
    body: (row.body as string | null) ?? null,
    payload: (row.payload as InsightAction | null) ?? null,
    status: (row.status ?? 'new') as CoachInsightRow['status'],
    generated_for: String(row.generated_for),
    created_at: String(row.created_at),
  }
}

export async function listInsights(
  userId: string,
  options: { generatedFor?: string; statuses?: CoachInsightRow['status'][]; limit?: number } = {}
): Promise<CoachInsightRow[]> {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('ai_insights')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('generated_for', { ascending: false })
    .order('severity', { ascending: true })
    .limit(options.limit ?? 20)

  if (options.generatedFor) query = query.eq('generated_for', options.generatedFor)
  if (options.statuses?.length) query = query.in('status', options.statuses)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map(toRow)
}

/**
 * 日次バッチが生成した洞察を保存する。
 * (user_id, generated_for, type, title) が一意なので、同じ日に何度回しても増殖しない。
 */
export async function saveInsights(
  userId: string,
  insights: CoachInsight[]
): Promise<CoachInsightRow[]> {
  if (insights.length === 0) return []
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('ai_insights').upsert(
    insights.map(insight => ({
      user_id: userId,
      type: insight.type,
      severity: insight.severity,
      title: insight.title,
      body: insight.body,
      payload: insight.payload,
      generated_for: insight.generated_for,
    })),
    { onConflict: 'user_id,generated_for,type,title', ignoreDuplicates: false }
  )

  if (error) throw new Error(error.message)
  return listInsights(userId, { generatedFor: insights[0].generated_for })
}

export async function updateInsightStatus(
  userId: string,
  insightId: string,
  status: CoachInsightRow['status']
): Promise<CoachInsightRow> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('ai_insights')
    .update({ status })
    .eq('user_id', userId)
    .eq('id', insightId)
    .select(COLUMNS)
    .single()

  if (error) throw new Error(error.message)
  return toRow(data)
}

/** オンボーディングの回答(価値観・重視点)。コーチの優先度・口調に反映する。 */
export async function saveUserMemory(
  userId: string,
  profile: Record<string, unknown>
): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('ai_user_memory').upsert(
    { user_id: userId, profile, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )
  if (error) throw new Error(error.message)
}

export async function getUserMemory(userId: string): Promise<Record<string, unknown> | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('ai_user_memory')
    .select('profile')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data?.profile as Record<string, unknown> | null) ?? null
}
