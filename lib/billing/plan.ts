// lib/billing/plan.ts
//
// プラン判定の純関数。DB I/O を持たないのでそのままテストできる。
//
// Stripe を課金の Source of Truth とし、Subscription があればそれを優先する。
// 無ければ既存の user_entitlements（買い切り・legacy_pro）へフォールバックする。

export type Plan = 'free' | 'pro' | 'legacy_pro'

/** Stripe subscription.status のうち、利用を許すもの */
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])

/** Pro 相当として扱うプラン。買い切りの pro_lifetime も含む */
const PRO_EQUIVALENT_ENTITLEMENTS = new Set(['pro', 'pro_lifetime', 'legacy_pro'])

export type SubscriptionState = {
  status: string
  current_period_end: string | null
} | null

export type EntitlementState = {
  plan: string
  status: string
} | null

/**
 * 契約状態からプランを決める。
 *
 * past_due / canceled / unpaid の Subscription を持っていても、
 * 期限内の legacy_pro や買い切りがあればそちらで救う（既存ユーザーを落とさない）。
 */
export function resolvePlan(input: {
  subscription: SubscriptionState
  entitlement: EntitlementState
  now?: Date
}): Plan {
  const now = input.now ?? new Date()

  const sub = input.subscription
  if (sub && ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status)) {
    // 期間終了が過ぎていれば active でも有効としない（Webhook遅延の保険）
    if (!sub.current_period_end || new Date(sub.current_period_end) > now) {
      return 'pro'
    }
  }

  const ent = input.entitlement
  if (ent && ent.status === 'active' && PRO_EQUIVALENT_ENTITLEMENTS.has(ent.plan)) {
    return ent.plan === 'legacy_pro' ? 'legacy_pro' : 'pro'
  }

  return 'free'
}

/** Pro 相当か。legacy_pro も Pro として扱う */
export function isProPlan(plan: Plan): boolean {
  return plan === 'pro' || plan === 'legacy_pro'
}

/**
 * 課金チェックを強制するか。
 *
 * Production では環境変数に関わらず必ず強制する。設定漏れで全機能が
 * 開放される状態を作らないため（fail-closed）。
 * 開発・テストでのみ BILLING_REQUIRED=false で明示的に外せる。
 */
export function isBillingEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return true
  return env.BILLING_REQUIRED !== 'false'
}
