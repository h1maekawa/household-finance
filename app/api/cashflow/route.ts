import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { projectCashflow } from '@/lib/cashflow'
import { ScheduledPayment } from '@/types/cashflow'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const [balanceRes, paymentsRes] = await Promise.all([
    supabaseAdmin
      .from('account_balance')
      .select('*')
      .eq('user_id', user.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('scheduled_payments')
      .select('*')
      .eq('user_id', user.id)
      .order('due_day', { ascending: true }),
  ])

  if (balanceRes.error) {
    return Response.json({ error: balanceRes.error.message }, { status: 500 })
  }
  if (paymentsRes.error) {
    return Response.json({ error: paymentsRes.error.message }, { status: 500 })
  }

  const scheduledPayments: ScheduledPayment[] = paymentsRes.data ?? []
  const currentBalance = balanceRes.data?.balance ?? 0
  const projectedDays = projectCashflow(currentBalance, scheduledPayments, 30)

  return Response.json({
    currentBalance: balanceRes.data,
    projectedDays,
    scheduledPayments,
  })
}
