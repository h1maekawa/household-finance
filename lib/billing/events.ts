// lib/billing/events.ts
//
// Stripe Webhook の冪等性。
//
// 「event_id を保存したが業務処理に失敗し、再送されても処理されない」状態を
// 作らないため、受理と完了を分けて記録する。判断は純関数に切り出してテストする。
import { supabaseAdmin } from '@/lib/supabase'

export type StripeEventRow = {
  event_id: string
  event_type: string
  status: 'processing' | 'processed' | 'failed'
  attempts: number
  received_at: string
}

export type EventAction = 'process' | 'skip' | 'retry'

/**
 * processing のまま放置されたイベントを引き取るまでの猶予。
 * 他のワーカーが処理中の可能性があるので即座には奪わない。
 */
export const STALE_PROCESSING_MS = 5 * 60 * 1000

/**
 * 既存レコードから、このイベントをどう扱うか決める。
 *
 * - 未登録            → process（新規に受理する）
 * - processed         → skip（二重適用しない）
 * - failed            → retry（前回失敗したので処理し直す）
 * - processing（新しい）→ skip（別のワーカーが処理中）
 * - processing（古い） → retry（異常終了したとみなして引き取る）
 */
export function decideEventAction(
  existing: StripeEventRow | null,
  now: Date = new Date()
): EventAction {
  if (!existing) return 'process'
  if (existing.status === 'processed') return 'skip'
  if (existing.status === 'failed') return 'retry'

  const age = now.getTime() - new Date(existing.received_at).getTime()
  return age > STALE_PROCESSING_MS ? 'retry' : 'skip'
}

/** イベントを受理する。既に処理済みなら false を返して処理をスキップさせる */
export async function claimEvent(eventId: string, eventType: string): Promise<boolean> {
  const { data: existing, error } = await supabaseAdmin
    .from('stripe_events')
    .select('event_id, event_type, status, attempts, received_at')
    .eq('event_id', eventId)
    .maybeSingle()

  if (error) throw new Error(`stripe_events の参照に失敗しました: ${error.message}`)

  const action = decideEventAction(existing as StripeEventRow | null)
  if (action === 'skip') return false

  const payload: {
    event_id: string
    event_type: string
    status: string
    attempts: number
    received_at?: string
  } = {
    event_id: eventId,
    event_type: eventType,
    status: 'processing',
    attempts: action === 'process' ? 1 : ((existing as StripeEventRow | null)?.attempts ?? 0) + 1,
  }
  // 引き取り直すときは受理時刻を更新する（次の stale 判定の起点にするため）
  if (action === 'retry') payload.received_at = new Date().toISOString()

  const { error: upsertError } = await supabaseAdmin
    .from('stripe_events')
    .upsert(payload, { onConflict: 'event_id' })

  if (upsertError) throw new Error(`stripe_events の記録に失敗しました: ${upsertError.message}`)
  return true
}

/** 業務処理が成功して初めて processed にする */
export async function markEventProcessed(eventId: string): Promise<void> {
  await supabaseAdmin
    .from('stripe_events')
    .update({ status: 'processed', processed_at: new Date().toISOString(), last_error: null })
    .eq('event_id', eventId)
}

/** 失敗を残す。Stripe の再送で retry として拾い直せる */
export async function markEventFailed(eventId: string, message: string): Promise<void> {
  await supabaseAdmin
    .from('stripe_events')
    .update({ status: 'failed', last_error: message.slice(0, 500) })
    .eq('event_id', eventId)
}
