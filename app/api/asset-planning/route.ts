import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadAssetPlanning } from '@/lib/services/asset-planning-loader'
import { readFailed } from '@/lib/api-errors'

export const dynamic = 'force-dynamic'

function currentMonthJst(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit',
  }).format(new Date())
}

function todayJst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/**
 * GET /api/asset-planning?month=YYYY-MM
 *
 * 画面向けの資産形成プラン。認証はユーザーセッションで、DBアクセスは
 * セッションクライアント + RLS。Integration 用の
 * /api/integrations/investment-capacity（Token + service_role）を
 * UI から叩かないための入口。計算は共通の Loader を通すので複製しない。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const monthParam = request.nextUrl.searchParams.get('month')
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '') ? (monthParam as string) : currentMonthJst()

  try {
    const { plan, assets } = await loadAssetPlanning(user.id, month, todayJst(), supabase)
    return Response.json({ ...plan, assets })
  } catch (error) {
    return readFailed('api/asset-planning', error)
  }
}
