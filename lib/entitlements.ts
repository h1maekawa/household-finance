// lib/entitlements.ts
//
// 権限判定の入口。既存の呼び出し（requireActiveEntitlement）を壊さずに、
// fail-closed かつ Subscription / legacy_pro を理解する形へ差し替えている。
//
// プラン解決の規則そのものは lib/billing/plan.ts（純関数）にある。
import { isBillingEnforced, isProPlan, resolvePlan, type Plan } from '@/lib/billing/plan'
import { getEntitlement, getSubscription } from '@/lib/billing/subscriptions'

export type { Plan }

/** 現在のプラン。Subscription を優先し、無ければ既存の entitlement で判定する */
export async function getPlan(userId: string): Promise<Plan> {
  const [subscription, entitlement] = await Promise.all([
    getSubscription(userId),
    getEntitlement(userId),
  ])
  return resolvePlan({ subscription, entitlement })
}

/** Pro 相当のアクセス権を持つか（legacy_pro を含む） */
export async function hasActiveEntitlement(userId: string): Promise<boolean> {
  return isProPlan(await getPlan(userId))
}

/**
 * Pro 機能の利用可否。
 *
 * 課金チェックは fail-closed。Production では環境変数の設定に関わらず必ず有効で、
 * 設定漏れによって全機能が開放されることはない（lib/billing/plan.ts）。
 * 開発・テストでのみ BILLING_REQUIRED=false で明示的に外せる。
 */
export async function requireActiveEntitlement(userId: string): Promise<boolean> {
  if (!isBillingEnforced()) return true
  return hasActiveEntitlement(userId)
}

export { isBillingEnforced }
