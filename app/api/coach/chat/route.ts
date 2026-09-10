import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadAiFpAnswerSource } from '@/lib/services/ai-fp-loader'
import { explainFinance } from '@/lib/gemini'
import { writeFailed } from '@/lib/api-errors'
import { currentMonthJst, todayJst } from '@/lib/jst'

export const dynamic = 'force-dynamic'

/**
 * POST /api/coach/chat — AI FP の回答（スペック §33）。
 *
 *   質問 → 必要な計算の判定(決定論) → Finance Engine → 計算結果 → AIが説明
 *
 * **AI は金額を作らない。** 質問の意図と金額の読み取りも AI にやらせず、
 * ai-fp-intent.ts の決定論パーサが行う。AI へ渡すのは計算済みの結果だけで、
 * 生の取引は送らない。
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
    const source = await loadAiFpAnswerSource(
      user.id,
      question,
      currentMonthJst(),
      todayJst(),
      supabase
    )
    const answer = await explainFinance(question, source.context)

    // scenario は決定論の値。画面は AI の文章ではなくこちらを数字として出す
    return Response.json({ answer, intent: source.intent.kind, scenario: source.scenario })
  } catch (error) {
    return writeFailed('api/coach/chat', error)
  }
}
