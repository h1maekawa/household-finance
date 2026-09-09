// lib/billing/subscriptions.ts
//
// Subscription のローカル状態。Stripe を Source of Truth とし、
// Feature Authorization に必要な最小限だけを保存する。
import { supabaseAdmin } from '@/lib/supabase'
import type { EntitlementState, SubscriptionState } from './plan'

export type SubscriptionUpsert = {
  userId: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export async function upsertSubscription(input: SubscriptionUpsert): Promise<void> {
  const { error } = await supabaseAdmin.from('user_subscriptions').upsert(
    {
      user_id: input.userId,
      stripe_customer_id: input.stripeCustomerId,
      stripe_subscription_id: input.stripeSubscriptionId,
      stripe_price_id: input.stripePriceId,
      status: input.status,
      current_period_end: input.currentPeriodEnd,
      cancel_at_period_end: input.cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (error) throw new Error(`user_subscriptions の更新に失敗しました: ${error.message}`)
}

/** Stripe の customer から利用者を引く。subscription 系イベントは user_id を持たないため */
export async function findUserIdByCustomer(customerId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('user_subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (error) throw new Error(`user_subscriptions の参照に失敗しました: ${error.message}`)
  return data?.user_id ?? null
}

export async function getSubscription(userId: string): Promise<SubscriptionState> {
  const { data, error } = await supabaseAdmin
    .from('user_subscriptions')
    .select('status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle()
  // 読めなかったことを「契約なし」と混同しない。Proユーザーを黙って降格させない
  if (error) throw new Error(`user_subscriptions の参照に失敗しました: ${error.message}`)
  return data ? { status: data.status, current_period_end: data.current_period_end } : null
}

export async function getEntitlement(userId: string): Promise<EntitlementState> {
  const { data, error } = await supabaseAdmin
    .from('user_entitlements')
    .select('plan, status')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`user_entitlements の参照に失敗しました: ${error.message}`)
  return data ? { plan: data.plan, status: data.status } : null
}
