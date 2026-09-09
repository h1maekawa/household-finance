// lib/billing/events.ts
//
// Stripe Webhook の冪等性。
//
// 「event_id を保存したが業務処理に失敗し、再送されても処理されない」状態と、
// 「同じイベントが同時に2回届いて両方処理される」状態の両方を防ぐ。
//
// 受理の判定は SQL 関数 claim_stripe_event に閉じている。アプリ側で
// SELECT → 判定 → UPSERT に分けると、その間に別ワーカーが割り込めるため。
// 判定ロジックをTS側にも書くと正が2箇所になるので、ここには置かない。
import { supabaseAdmin } from '@/lib/supabase'

/**
 * processing のまま放置されたイベントを引き取るまでの猶予。
 * SQL 関数の既定値と揃えること（025_claim_stripe_event.sql）。
 */
export const STALE_PROCESSING = '5 minutes'

/**
 * このイベントを処理する権利を取る。
 *
 * true を返したワーカーだけが業務処理へ進む。false は次のいずれか。
 *   - 既に processed（二重適用しない）
 *   - 別のワーカーが処理中
 */
export async function claimEvent(eventId: string, eventType: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('claim_stripe_event', {
    p_event_id: eventId,
    p_event_type: eventType,
    p_stale_after: STALE_PROCESSING,
  })

  if (error) throw new Error(`stripe_events の受理に失敗しました: ${error.message}`)
  return data === true
}

/**
 * 業務処理が成功して初めて processed にする。
 *
 * ここが失敗したら throw する。Webhook を200で返してしまうと Stripe が
 * 再送しなくなり、processing のまま取り残されるため。
 * 500を返して再送させた場合はハンドラが再実行されるので、
 * 各ハンドラは冪等（UPSERT 基本）である必要がある。
 */
export async function markEventProcessed(eventId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('stripe_events')
    .update({ status: 'processed', processed_at: new Date().toISOString(), last_error: null })
    .eq('event_id', eventId)

  if (error) throw new Error(`stripe_events の完了記録に失敗しました: ${error.message}`)
}

/**
 * 失敗を残す。Stripe の再送で claim し直せる。
 *
 * ここが失敗しても投げない。呼び出し元は既に失敗して500を返す途中であり、
 * 記録漏れは stale processing として猶予後に回収されるため。
 */
export async function markEventFailed(eventId: string, message: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('stripe_events')
    .update({ status: 'failed', last_error: message.slice(0, 500) })
    .eq('event_id', eventId)

  if (error) {
    console.error(`[billing] stripe_events の失敗記録に失敗: ${error.message}`)
  }
}
