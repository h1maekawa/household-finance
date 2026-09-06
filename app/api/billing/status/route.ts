import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { getPlan, isBillingEnforced } from '@/lib/entitlements'
import { isProPlan } from '@/lib/billing/plan'

/**
 * GET /api/billing/status
 *
 * billingRequired はサーバー側で算出した値を返す。
 * 課金制御を NEXT_PUBLIC_ の環境変数でクライアントへ出さない。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const plan = await getPlan(user.id)

  return Response.json({
    active: isProPlan(plan),
    plan,
    billingRequired: isBillingEnforced(),
  })
}
