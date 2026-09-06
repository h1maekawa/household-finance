import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadAssetPlanning } from '@/lib/services/asset-planning-loader'
import { buildCoachExplainContext } from '@/lib/services/coach-explain-context'
import { explainFinance } from '@/lib/gemini'
import { writeFailed } from '@/lib/api-errors'

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
 * POST /api/coach/chat
 *
 * 計算済みの結果を AI に説明させる。AI は金額を作らない。
 * 渡すのは asset-planning が出した値だけで、生の取引は送らない。
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: 'AIの設定がありません' }, { status: 503 })
  }

  const body = (await request.json().catch(() => ({}))) as { question?: unknown }
  const question = String(body.question ?? '').trim().slice(0, 200)
  if (!question) {
    return Response.json({ error: '質問を入力してください' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()

  try {
    const { plan, assets } = await loadAssetPlanning(
      user.id,
      currentMonthJst(),
      todayJst(),
      supabase
    )
    const answer = await explainFinance(question, buildCoachExplainContext(plan, assets))
    return Response.json({ answer })
  } catch (error) {
    return writeFailed('api/coach/chat', error)
  }
}
