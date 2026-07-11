import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { hasActiveEntitlement } from '@/lib/entitlements'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  return Response.json({
    active: await hasActiveEntitlement(user.id),
    billingRequired: process.env.NEXT_PUBLIC_BILLING_REQUIRED === 'true',
  })
}
