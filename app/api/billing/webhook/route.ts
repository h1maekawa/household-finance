import { claimEvent, markEventFailed, markEventProcessed } from '@/lib/billing/events'
import { dispatchStripeEvent } from '@/lib/billing/handlers'
import { verifyStripeEvent, WebhookVerificationError } from '@/lib/billing/stripe'

export const runtime = 'nodejs'

/**
 * POST /api/billing/webhook
 *
 * ここは署名検証・受理・振り分け・HTTPレスポンスだけを持つ。
 * イベントごとの業務処理は lib/billing/handlers.ts にある。
 *
 * service_role を使うのは Webhook がセッションを持たないため（SECURITY.md の許可範囲）。
 */
export async function POST(request: Request) {
  // 署名検証には Stripe が送ってきた生のボディが要る。パースして再構成しない
  const rawBody = await request.text()

  let event
  try {
    event = verifyStripeEvent(
      rawBody,
      request.headers.get('stripe-signature'),
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error('[billing/webhook] 署名検証に失敗:', error.message)
      return Response.json({ error: 'Invalid signature' }, { status: 400 })
    }
    console.error('[billing/webhook] Stripe クライアントの初期化に失敗:', error)
    return Response.json({ error: 'Webhook is not configured' }, { status: 503 })
  }

  // 二重適用を防ぐ。processed 済みなら何もしない
  let claimed: boolean
  try {
    claimed = await claimEvent(event.id, event.type)
  } catch (error) {
    console.error('[billing/webhook] イベントの受理に失敗:', error)
    return Response.json({ error: 'Failed to record event' }, { status: 500 })
  }
  if (!claimed) return Response.json({ received: true, duplicate: true })

  try {
    await dispatchStripeEvent(event)
    await markEventProcessed(event.id)
    return Response.json({ received: true })
  } catch (error) {
    // failed として残す。Stripe の再送で retry として拾い直す
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[billing/webhook] ${event.type} の処理に失敗:`, message)
    await markEventFailed(event.id, message).catch(() => {})
    return Response.json({ error: 'Event processing failed' }, { status: 500 })
  }
}
