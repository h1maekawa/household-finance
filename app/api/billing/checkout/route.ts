import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'

/**
 * POST /api/billing/checkout
 *
 * Checkout セッションを作る。現時点は買い切り（mode: 'payment'）のまま。
 * Subscription への切り替えは Phase 5 で mode と Price を差し替える。
 * Webhook 側は既に subscription 系イベントを処理できる。
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  if (!isStripeConfigured()) {
    return Response.json({ error: 'Stripe is not configured' }, { status: 503 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      success_url: `${appUrl}/settings?billing=success`,
      cancel_url: `${appUrl}/settings?billing=cancel`,
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      customer_email: user.email ?? undefined,
    })
    return Response.json({ url: session.url })
  } catch (error) {
    // Stripe の生メッセージはユーザーへ返さない（サーバーログにだけ残す）
    console.error('[billing/checkout] Checkout の作成に失敗:', error)
    return Response.json({ error: '決済ページを開けませんでした' }, { status: 500 })
  }
}
