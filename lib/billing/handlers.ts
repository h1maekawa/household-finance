// lib/billing/handlers.ts
//
// Stripe Event ごとの業務処理。route.ts を肥大化させないためここに置く。
// 各ハンドラは失敗したら throw する（呼び出し側が failed として記録し、
// Stripe の再送で処理し直せるようにするため）。
//
// 再送で同じイベントが再実行されうるので、各ハンドラは冪等でなければならない。
// 状態を「加算」せず、UPSERT と固定値の UPDATE だけで書くこと。
import type Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase'
import { findUserIdByCustomer, upsertSubscription } from './subscriptions'

function isoOrNull(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null
}

function stringId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' ? id : null
  }
  return null
}

/** Subscription オブジェクトから user を引く。metadata → customer の順 */
async function resolveUserId(
  subscription: Stripe.Subscription
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.user_id
  if (fromMetadata) return fromMetadata
  const customerId = stringId(subscription.customer)
  return customerId ? findUserIdByCustomer(customerId) : null
}

/** Subscription の状態をそのままローカルへ写す */
async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserId(subscription)
  if (!userId) throw new Error(`Subscription ${subscription.id} に対応する user が見つかりません`)

  const item = subscription.items?.data?.[0]
  await upsertSubscription({
    userId,
    stripeCustomerId: stringId(subscription.customer),
    stripeSubscriptionId: subscription.id,
    stripePriceId: item?.price?.id ?? null,
    status: subscription.status,
    currentPeriodEnd: isoOrNull(
      (item as { current_period_end?: number } | undefined)?.current_period_end
    ),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  })
}

export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.user_id ?? session.client_reference_id
  if (!userId) throw new Error('checkout.session に user_id がありません')

  const customerId = stringId(session.customer)
  const subscriptionId = stringId(session.subscription)

  if (session.mode === 'subscription' && subscriptionId) {
    // 契約の詳細は customer.subscription.* が運ぶ。ここでは紐付けだけ確定させる
    await upsertSubscription({
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: null,
      status: 'incomplete',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    })
    return
  }

  // 買い切り。既存の user_entitlements を正として維持する（後方互換）
  const { error } = await supabaseAdmin.from('user_entitlements').upsert(
    {
      user_id: userId,
      plan: 'pro_lifetime',
      status: 'active',
      source: 'stripe',
      stripe_customer_id: customerId,
      stripe_checkout_session_id: session.id,
      purchased_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (error) throw new Error(`user_entitlements の更新に失敗しました: ${error.message}`)
}

export async function handleSubscriptionUpserted(
  subscription: Stripe.Subscription
): Promise<void> {
  await syncSubscription(subscription)
}

export async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  // 行は消さない。いつ解約されたかを残し、legacy_pro や買い切りでの
  // フォールバック判定（resolvePlan）をそのまま働かせる
  await syncSubscription({ ...subscription, status: 'canceled' } as Stripe.Subscription)
}

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = stringId(
    (invoice as { subscription?: unknown }).subscription
  )
  if (!subscriptionId) return // 単発の請求書。契約状態は変わらない

  const customerId = stringId(invoice.customer)
  if (!customerId) return
  const userId = await findUserIdByCustomer(customerId)
  if (!userId) throw new Error(`invoice ${invoice.id} に対応する user が見つかりません`)

  const { error } = await supabaseAdmin
    .from('user_subscriptions')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw new Error(`user_subscriptions の更新に失敗しました: ${error.message}`)
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = stringId(invoice.customer)
  if (!customerId) return
  const userId = await findUserIdByCustomer(customerId)
  if (!userId) return // 未知の customer は無視（未処理として残さない）

  const { error } = await supabaseAdmin
    .from('user_subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw new Error(`user_subscriptions の更新に失敗しました: ${error.message}`)
}

/** Event を対応するハンドラへ振り分ける。未対応の型は無視する */
export async function dispatchStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return handleSubscriptionUpserted(event.data.object as Stripe.Subscription)
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
    case 'invoice.paid':
      return handleInvoicePaid(event.data.object as Stripe.Invoice)
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
    default:
      return
  }
}
