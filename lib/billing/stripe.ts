// lib/billing/stripe.ts
//
// Stripe SDK の入口。署名検証は必ず公式の constructEvent を通す。
// 独自のHMAC実装を持たない（timestamp の許容範囲検証を自前で書かないため）。
import Stripe from 'stripe'

let client: Stripe | null = null

/** Stripe クライアント。未設定なら明示的に落とす */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY が未設定です')
  if (!client) client = new Stripe(key)
  return client
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID)
}

export class WebhookVerificationError extends Error {}

/**
 * Webhook の署名を検証してイベントを取り出す。
 *
 * rawBody は Stripe が送ってきたバイト列そのものであること。
 * JSON.parse して再度 stringify したものでは署名が一致しない。
 *
 * constructEvent は署名の一致に加えて timestamp の許容範囲も見るため、
 * 古い署名の再送（replay）はここで弾かれる。
 */
export function verifyStripeEvent(
  rawBody: string,
  signature: string | null,
  secret: string | undefined,
  stripe: Stripe = getStripe()
): Stripe.Event {
  if (!secret) throw new WebhookVerificationError('STRIPE_WEBHOOK_SECRET が未設定です')
  if (!signature) throw new WebhookVerificationError('stripe-signature ヘッダーがありません')

  try {
    return stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (error) {
    throw new WebhookVerificationError(
      error instanceof Error ? error.message : 'Webhook の署名検証に失敗しました'
    )
  }
}
