import { supabaseAdmin } from '@/lib/supabase'

export async function hasActiveEntitlement(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_entitlements')
    .select('status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  if (error) return false
  return Boolean(data)
}

export async function requireActiveEntitlement(userId: string) {
  if (process.env.NEXT_PUBLIC_BILLING_REQUIRED !== 'true') return true
  return hasActiveEntitlement(userId)
}
